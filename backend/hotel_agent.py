import os
import asyncio
import base64
import json
import boto3
import uuid
import warnings
import pyaudio
import pytz
import random
import hashlib
import datetime
import time
import inspect


from aws_sdk_bedrock_runtime.client import (
    BedrockRuntimeClient,
    InvokeModelWithBidirectionalStreamOperationInput,
)
from aws_sdk_bedrock_runtime.models import (
    InvokeModelWithBidirectionalStreamInputChunk,
    BidirectionalInputPayloadPart,
)

from aws_sdk_bedrock_runtime.config import Config
from smithy_aws_core.identity.environment import EnvironmentCredentialsResolver
from decimal import Decimal
from boto3.dynamodb.conditions import Attr

# Suppress warnings
warnings.filterwarnings("ignore")


# Audio configuration
INPUT_SAMPLE_RATE = 16000  #microphone input is recorded at 16000 samples/second i.e 16000 kilo hertz that is what nova sonic expects for incoming speech (16000 means less audio quality but still it will be able to identify) 
OUTPUT_SAMPLE_RATE = 24000 # audio we play back from nova sonic 24000 samples/second i.e 24000 kilo hertz (24000 is better quality response)
CHANNELS = 1 # means audio is mono not stereo with two channels. one channel is standard for voice agents
FORMAT = pyaudio.paInt16  # each sample 16 bite signed integer and common raw audio format
CHUNK_SIZE = 1024 # Number of frames per buffer. meaning we read and write audio in blocks of 1024 samples at a time. #smaller chunks means lower latency its faster but more CPU overhead and can be interrupted quickly. 1024 is the nice middle ground of real time streaming.


# Debug mode flag
DEBUG = False  # when it is true it prints the current timestamp, name of the function that called and message that passed in 

def debug_print(message):
    """Print only if debug mode is enables"""
    if DEBUG:
        functionName = inspect.stack()[1].function
        if functionName == "time_it" or functionName == "time_it_async":
            functionName = inspect.stack()[2].function
        print(
            "{:%Y-%m-%d %H:%M:%S.%f}".format(datetime.datetime.now())[:-3]
            + " "
            + functionName
            + " "
            + message
        )

def time_it(label,methodToRun):
    start_time = time.perf_counter()
    result = methodToRun()
    end_time = time.perf_counter()
    debug_print(f"Execution time for {label}: {end_time - start_time:.4f} seconds")
    return result

async def time_it_async(label, methodToRun):
    start_time = time.perf_counter()
    result = await methodToRun()
    end_time = time.perf_counter()
    debug_print(f"Exceution time for {label}: {end_time - start_time:.4f} seconds")
    return result


# Room types the hotel actually offers. Any update request outside this set is
# rejected, so a garbled or hallucinated value cannot be written to a booking.
ALLOWED_ROOM_TYPES = {
    "king deluxe": "King Deluxe",
    "queen standard": "Queen Standard",
    "twin standard": "Twin Standard",
    "suite": "Suite",
    "king suite": "King Suite",
}


def normalize_dob(value):
    """
    Reduce a spoken date of birth to YYYY-MM-DD so it can be compared exactly.

    The model transcribes speech like "June fifth, nineteen ninety-one" into a
    date string, but not always in the same format. Returns None when the value
    cannot be parsed - and an unparseable date must never count as a match.
    """
    if not value or not isinstance(value, str):
        return None

    text = value.strip()

    # Try the formats the model realistically produces, most likely first.
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%B %d, %Y", "%B %d %Y", "%d %B %Y"):
        try:
            return datetime.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue                        # Not this format - try the next.

    return None                             # Unrecognised: treat as a failed match.


class ToolProcessor:
    def __init__(self):
        self.tasks = {}
        self.dynamodb = boto3.resource("dynamodb",region_name="us-east-1")
        self.guest_table = self.dynamodb.Table("Hotel_Guests")
        self.reservation_table = self.dynamodb.Table("Hotel_Reservations")

        # Identity verification state for THIS conversation only. A new
        # ToolProcessor is built per session, so verification cannot leak
        # between callers. Until checkGuestProfileTool confirms a matching
        # date of birth this stays None, and every other tool refuses to
        # return data.
        #
        # This is enforced in code rather than in the system prompt on purpose:
        # a prompt instruction is a request the model may ignore, and testing
        # showed it did - confirming identity for a wrong DOB, and even for a
        # guest that did not exist.
        self.verified_guest = None

        # The change the guest has been read back but has not yet confirmed.
        # updateReservationTool writes nothing until a commit arrives carrying
        # the matching proposalId, so the read-back step cannot be skipped:
        # there is no id to commit with until a proposal has been made.
        self.pending_proposal = None

        try:
            self.loop = asyncio.get_running_loop() # Returns the currently running event loop and raises an error if no event loop is running.
        except:
            self.loop = asyncio.get_event_loop() # Returns an event loop to use (or creates/returns one, depending on the Python version and context).

    
    
    async def process_tool_async(self, tool_name, tool_content):
        """Process a tool call asynchronously and return the result"""

        # Create a unique task ID
        task_id = str(uuid.uuid4())


        # Create and store the task
        task = asyncio.create_task(self._run_tool(tool_name,tool_content))
        self.tasks[task_id] = task

        try:
            # Wait for the task to complete
            result = await task
            return result
        finally:
            #Clean up teh task reference
            if task_id in self.tasks:
                del self.tasks[task_id]

# toolname will be given by nova sonic premium 
    async def _run_tool(self, tool_name, tool_content):
        """Internal method to execute the tool logic"""
        debug_print(f"Process tool: {tool_name}")
        tool = tool_name.lower()
        content = tool_content.get("content",{})
        if isinstance(content, str):
            try:
                content_data = json.loads(content)
            except json.JSONDecodeError:
                content_data = content
        else:
            content_data = content

        # The purpose we running in order thread or run_in_executor is because aws responses takes time so within that time other processes should not get stuck in the loop
        if tool == "checkguestprofiletool":
            # Look up the guest in Hotel_Guests
            return await self.loop.run_in_executor(
                None,
                self._execute_check_guest,
                content_data
            )
        elif tool == "checkreservationstatustool":
            # Look up upcoming and past reservations for this guest
            return await self.loop.run_in_executor(
                None,
                self._execute_check_reservation_status,
                content_data
            )
        elif tool == "updatereservationtool":
            # Update room type and/or special requests
            return await self.loop.run_in_executor(
                None,
                self._execute_update_reservation,
                content_data
            )
        else:
            return {"error": f"Unsupported tool: {tool_name}"}



    def _execute_check_guest(self, content_data):
        """
        Look up a guest profile in Hotel_Guests by guestName.
        Used for identity verification and preferences.
        """
        try:
            guest_name=content_data.get("guestName","")
            if not guest_name:
                return {"error":"guestName is required"}

            # The date of birth the GUEST spoke, passed through by the model.
            spoken_dob = content_data.get("dateOfBirth","")
            if not spoken_dob:
                # Without something to compare against there is nothing to
                # verify, so refuse rather than returning the profile.
                return {
                    "verified": False,
                    "message": "dateOfBirth is required to verify identity. Ask the guest for it.",
                }

            response = self.guest_table.get_item(Key={'guestName':guest_name})

            if 'Item' not in response:
                # Guest does not exist. Return NO profile data - and say plainly
                # that verification failed, so the model cannot read this as a
                # partial success.
                self.verified_guest = None
                return {
                    "verified": False,
                    "found": False,
                    "message": "No guest found with that name. Identity is NOT verified.",
                }

            item = response['Item']

            # ---- The actual gate ------------------------------------------
            # Compare in Python, not in the prompt. Both sides are normalised to
            # YYYY-MM-DD first so formatting differences cannot cause a false
            # mismatch; an unparseable value normalises to None and fails.
            stored = normalize_dob(item.get('dob'))
            spoken = normalize_dob(spoken_dob)

            if stored is None or spoken is None or stored != spoken:
                self.verified_guest = None          # Explicitly revoke any prior verification.
                return {
                    "verified": False,
                    "found": True,
                    # Deliberately does NOT echo the stored DOB - that would let
                    # a caller probe for the correct value by guessing.
                    "message": (
                        "The date of birth provided does not match our records. "
                        "Identity is NOT verified. Do not disclose any reservation "
                        "or billing details."
                    ),
                }

            # Verified. Record it for this session so the other tools will run.
            self.verified_guest = item['guestName']

            return {
                "verified": True,
                "found": True,
                "guestName": item['guestName'],
                "loyaltyTier": item.get('loyaltyTier'),
                "phoneNumber": item.get('phoneNumber'),
                "email": item.get('email'),
                "preferredLanguage": item.get('preferredLanguage'),
                "preferredBedType": item.get('preferredBedType'),
                "preferredView": item.get('preferredView'),
                "vipFlag": bool(item.get('vipFlag', False))
            }

        except Exception as e:
            return {"error":str(e)}

    def _execute_check_reservation_status(self,content_data):
        """
        Check upcoming and (optionally) past reservations in Hotel_Reservations
        for a given guest.
        """
        try:
            from boto3.dynamodb.conditions import Attr
            import datetime as _dt

            guest_name = content_data.get("guestName")
            include_past = content_data.get("includePastStays",False)

            if not guest_name:
                return {"error":"guestName is required."}

            # ---- Verification gate ----------------------------------------
            # Reservation details are personal data. Refuse unless THIS session
            # already verified THIS guest through checkGuestProfileTool. The
            # check is on the name too, so verifying as one guest cannot be used
            # to read another guest's booking.
            if self.verified_guest != guest_name:
                return {
                    "verified": False,
                    "error": (
                        "Identity not verified for this guest. Call checkGuestProfileTool "
                        "with the guest's name and spoken date of birth first. "
                        "Do not disclose any reservation details."
                    ),
                }

            today_str = _dt.date.today().strftime('%Y-%m-%d')

            # Find all reservations for thsi guest
            filter_expression = Attr('guestName').eq(guest_name)
            response = self.reservation_table.scan(FilterExpression = filter_expression)
            items = response.get('Items',[])

            if not items:
                return {
                    "found": False,
                    "message": "No reservations found for this guest."
                }

            # Separate upcoimg/current vs past stays
            upcoming = []
            past = []

            for r in items:
                check_out = r.get('checkOutDate','')
                status = r.get('status','')
                # Normalize Decimal -> string for balanceDue
                if 'balanceDue' in r and isinstance(r['balanceDue'],Decimal):
                    r['balanceDue']=str(r['balanceDue'])

                if check_out >= today_str and status in ["Confirmed", "CheckedIn"]:
                    upcoming.append(r)
                else:
                    past.append(r)

            # Sort upcoming by checkInDate
            upcoming.sort(key=lambda x: x.get('checkInDate', '9999-99-99'))

            upcoming_res = upcoming[0] if upcoming else None
            past_stays = past if include_past else []

            message_parts = []
            if upcoming_res:
                msg = (
                    f"You have an upcoming stay in room {upcoming_res.get('roomNumber')}"
                    f"({upcoming_res.get('roomType')}) from "
                    f"{upcoming_res.get('checkInDate')} to {upcoming_res.get('checkOutDate')}."
                )
                if upcoming_res.get('paymentStatus') != "Paid":
                    msg += f" Your current balance due is {upcoming_res.get('balanceDue','0.00')}."

                message_parts.append(msg)

            else:
                message_parts.append("You have no upcoming reservations.")

            if include_past and past_stays:
                message_parts.append(f"I also found {len(past_stays)} past stay(s).")

            return {
                "found": True,
                "upcomingReservation": upcoming_res,
                "pastStays": past_stays,
                "message": " ".join(message_parts)
            }

        except Exception as e:
            return {"error": str(e)}

    def _execute_update_reservation(self,content_data):
        """
        Update a reservation's room type and/or special requests in Hotel_Reservations.
        - reservationId: required
        - newRoomType: optional string
        - newSpecialRequest: optional string (appended to specialRequests list)
        """
        try:
            reservation_id = content_data.get("reservationId")
            new_room_type = content_data.get("newRoomType")
            new_special_request = content_data.get("newSpecialRequest")
            new_check_out = content_data.get("newCheckOutDate")

            # "propose" computes and returns the change without writing.
            # "commit" applies a change the guest has already confirmed.
            mode = (content_data.get("mode") or "propose").strip().lower()
            proposal_id = content_data.get("proposalId")

            if not reservation_id:
                return {"error": "reservationId is required."}

            if mode not in ("propose", "commit"):
                return {"error": "mode must be 'propose' or 'commit'."}

            # ---- Verification gate ----------------------------------------
            # Modifying a booking is more sensitive than reading one, so the
            # same check applies - plus confirmation that the reservation being
            # changed actually belongs to the verified guest.
            if not self.verified_guest:
                return {
                    "verified": False,
                    "error": (
                        "Identity not verified. Call checkGuestProfileTool with the "
                        "guest's name and spoken date of birth before making changes."
                    ),
                }

            existing = self.reservation_table.get_item(
                Key={'reservationId': reservation_id}
            ).get("Item")

            if not existing:                                    # No such booking.
                return {"error": f"Reservation {reservation_id} not found."}

            if existing.get("guestName") != self.verified_guest:
                # Verified as someone else - refuse. Without this, a verified
                # guest could modify any booking by guessing its ID.
                return {
                    "verified": False,
                    "error": "This reservation belongs to a different guest. Refusing to modify it.",
                }

            # Build dynamic update expression
            update_parts = []
            expr_values = {}
            # rt - room_type
            if new_room_type:
                # Validate against the real room list. Testing showed the tool
                # would otherwise accept and store nonsense - a single "." was
                # written into a live booking as a room type.
                canonical = ALLOWED_ROOM_TYPES.get(new_room_type.strip().lower())
                if not canonical:
                    return {
                        "error": (
                            f"'{new_room_type}' is not a room type we offer. "
                            f"Valid options: {', '.join(sorted(set(ALLOWED_ROOM_TYPES.values())))}."
                        )
                    }
                update_parts.append("roomType = :rt")
                expr_values[":rt"]=canonical            # Store the canonical spelling.

            # co - check_out date. Added because the model previously could not
            # change dates, so when asked it appended a special request instead
            # and reported the date change as done. Supporting the operation
            # removes the incentive to fake it.
            if new_check_out:
                normalized_checkout = normalize_dob(new_check_out)   # Same YYYY-MM-DD parser.
                if not normalized_checkout:
                    return {"error": f"Could not understand the date '{new_check_out}'. Use YYYY-MM-DD."}
                if normalized_checkout <= existing.get("checkInDate", ""):
                    return {"error": "Check-out date must be after the check-in date."}
                update_parts.append("checkOutDate = :co")
                expr_values[":co"]=normalized_checkout
            # sr - special request
            if new_special_request:
                update_parts.append(
                    "specialRequests = list_append("
                    "if_not_exists(specialRequests, :empty_list), :sr)"
                )
                expr_values[":sr"]=[new_special_request]
                expr_values[":empty_list"]=[]

            if not update_parts:
                return {
                "error": "Nothing to update. Provide newRoomType, newCheckOutDate, and/or newSpecialRequest."
            }

            update_expression = "SET " + ", ".join(update_parts)

            # ---- Phase 1 of 2: propose -------------------------------------
            # Compute the change, describe it, and store it - but write nothing.
            # The guest has not agreed yet.
            if mode == "propose":
                changes = []                                  # Human-readable diff.
                if new_room_type:
                    changes.append({
                        "field": "roomType",
                        "from": existing.get("roomType"),
                        "to": expr_values.get(":rt"),
                    })
                if new_check_out:
                    changes.append({
                        "field": "checkOutDate",
                        "from": existing.get("checkOutDate"),
                        "to": expr_values.get(":co"),
                    })
                if new_special_request:
                    changes.append({
                        "field": "specialRequests",
                        "from": None,                          # An append, not a replace.
                        "to": new_special_request,
                    })

                new_id = f"PROP-{uuid.uuid4().hex[:8].upper()}"

                # Keep the prepared expression so commit replays exactly what was
                # read back - not a fresh interpretation of a second tool call.
                self.pending_proposal = {
                    "id": new_id,
                    "reservationId": reservation_id,
                    "expression": update_expression,
                    "values": expr_values,
                    "changes": changes,
                }

                return {
                    "mode": "proposal",
                    "proposalId": new_id,
                    "reservationId": reservation_id,
                    "changes": changes,
                    "written": False,
                    "message": (
                        "NOTHING HAS BEEN CHANGED YET. Read these changes back to the guest "
                        "and ask them to confirm. If they agree, call this tool again with "
                        f"mode='commit' and proposalId='{new_id}'."
                    ),
                }

            # ---- Phase 2 of 2: commit --------------------------------------
            # Only reachable with a proposalId issued by this session, so the
            # read-back cannot be bypassed.
            if not self.pending_proposal:
                return {"error": "No change has been proposed yet. Call with mode='propose' first."}

            if self.pending_proposal["id"] != proposal_id:
                return {
                    "error": (
                        "proposalId does not match the change that was read back to the guest. "
                        "Propose again and confirm before committing."
                    )
                }

            if self.pending_proposal["reservationId"] != reservation_id:
                return {"error": "This proposal was made for a different reservation."}

            # Replay the stored expression rather than the arguments of this call,
            # so what is written is exactly what the guest agreed to.
            update_expression = self.pending_proposal["expression"]
            expr_values = self.pending_proposal["values"]
            committed_changes = self.pending_proposal["changes"]
            self.pending_proposal = None                       # Single use.

            # Apply update
            self.reservation_table.update_item(
                Key={'reservationId': reservation_id},
                UpdateExpression=update_expression,
                ExpressionAttributeValues=expr_values
            )

            # Fetch updated reservation to return full context
            response = self.reservation_table.get_item(
                Key={'reservationId':reservation_id}
            )
            updated_item = response.get("Item",{})

            # Convert Decimal to string for balanceDue if present
            if 'balanceDue' in updated_item and isinstance(updated_item['balanceDue'],Decimal):
                updated_item['balanceDue']=str(updated_item['balanceDue'])

            msg_parts = [f"Reservation {reservation_id} has been updated."]
            for c in committed_changes:
                if c["field"] == "specialRequests":
                    msg_parts.append(f"Added special request: '{c['to']}'.")
                else:
                    msg_parts.append(f"{c['field']}: {c['from']} -> {c['to']}.")

            return {
                "success": True,
                "mode": "committed",
                "written": True,
                "changes": committed_changes,
                "message": " ".join(msg_parts),
                "updatedReservation": updated_item
            }
                    
        except Exception as e:
            return {"error": str(e)}


# Fields that must never leave the process. Tool results are shown in the
# browser's developer trace, which is likely to be screen-recorded or shared,
# so personal data is stripped before any event is emitted. Redaction happens
# here rather than in the UI: data that never leaves cannot be leaked by a
# frontend bug.
SENSITIVE_FIELDS = {"dob", "dateOfBirth", "email", "phoneNumber", "phone"}


def sanitize_for_ui(value):
    """Recursively replace sensitive values with a redaction marker."""
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if k in SENSITIVE_FIELDS else sanitize_for_ui(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [sanitize_for_ui(v) for v in value]
    if isinstance(value, Decimal):          # DynamoDB numbers are not JSON-serialisable.
        return str(value)
    return value


# It defines a helper object that manages the whole connection of Nova Sonic on Bedrock. Sends events, responses, pushes audio into queue for playback. When a model asks to user tool it calls toolProcessor and sends back the tool results and let nova sonic continue the conversation. So its the brain of the streaming layer.
# All Bedrock goes through this manager
class BedrockStreamManager:
    """Manages bidirectional streaming with AWS Bedrock using asyncio"""

    # Event templates
    # Model can generate upto 1024 tokens in its response before stopping
    # topP is set to 0.9 means the model chooses the next word only from the smallest group of most likely tokens whose combined probability adds up to 90%, ignoring the least likely 10%. This keeps the output more coherent and less random.
    # temperature = 0.7 controls how random the model's responses are.   
    START_SESSION_EVENT = """{
        "event" : {
            "sessionStart": {
            "inferenceConfiguration": {
                  "maxTokens": 1024, 
                  "topP": 0.9,
                  "temperature": 0.7
                }
            }
        }   
    }"""

    #LPCM (Linear Pulse Code Modulation) is raw, uncompressed audio data.
    # With PyAudio using paInt16, each audio sample is stored as a 16-bit signed integer. It contains no MP3-style compression and usually no file header—just raw audio bytes.
    # paInt16 = the data type used to represent each LPCM sample (16-bit signed integer).
    # "sampleRateHertz": 16000 means 16000 samples per second
    # "sampleSizeBits": 16 - Each sample uses 16 bites, matches paInt16
    # mono audio so channelcount is 1 the audio type is speech thats a hint to the backend optimized for human speech and it helps the model choose the appropriate front-end
    # encode is base64 it sends the audio in base64 format 
    CONTENT_START_EVENT = """{
         "event": {
             "contentStart":{
             "promptName": "%s",
             "contentName": "%s",
             "type": "AUDIO",
             "interactive": true,
             "role": "USER",
             "audioInputConfiguration": {
                   "mediaType": "audio/lpcm", 
                   "sampleRateHertz": 16000,
                   "sampleSizeBits": 16,
                   "channelCount": 1,
                   "audioType": "SPEECH",
                   "encoding": "base64"
                }
             }
         }
    }"""
    # Process audio input uses to send to Bedrock
    AUDIO_EVENT_TEMPLATE = """{
           "event": {
                "audioInput": {
                "promptName": "%s",
                "contentName": "%s",
                "content": "%s"
             }
        }
    }"""

    # Starts a new text content block Ex: system prompt, user typed message etc at start up, it can be any role so thats why it is mentioned role as "%s"
    TEXT_CONTENT_START_EVENT = """{
         "event": {
             "contentStart": {
                "promptName": "%s", 
                "contentName": "%s",
                "type": "TEXT",
                "role": "%s",
                "interactive": false,
                    "textInputConfiguration": {
                           "mediaType": "text/plain" 
                    }
            }
        }
    }"""

    # it carries the actual text payload for the current text content block. You send this after the text_content_start_event with the system_prompt or user_text again type the prompt_name/content_name  
    TEXT_INPUT_EVENT = """{
       "event": {
         "textInput": {
            "promptName": "%s",
            "contentName": "%s",
            "content": "%s"
         }
       }
    }"""

    # This is the entry point for the tool results back into the model. When the model sends you event.tool_use please call tool with arguments then run python tool then send this contentStart with type tool and enroll tool tied to the original tool_id. Then send a tool result event with the actual result. 
    #This tells the model now am streaming the result of the tool call with tool_id thats it wires the external tool output
    TOOL_CONTENT_START_EVENT = """{
    "event": {
         "contentStart": {
             "promptName": "%s",
             "contentName": "%s",
             "interactive": false,
             "type": "TOOL",
             "role": "TOOL",
             "toolResultInputConfiguration":{
                  "toolUseId": "%s",
                  "type": "TEXT",
                  "textInputConfiguration": {
                      "mediaType": "text/plain"
                  }
             }
         }
    }
    }"""

    # End of a single content piece Eg: audio textual tool, used after an audio content no more audio input for this turn
    CONTENT_END_EVENT = """{
        "event": {
             "contentEnd": {
                  "promptName": "%s",
                  "contentName": "%s"
             }
        }
    }"""

# Ends the prompt eg: one full conversational exchange and then you send this in the send_prompt end event as part of your close. Lets the model know this turn i sdone
   
    PROMPT_END_EVENT = """{
         "event": {
             "promptEnd": {
             "promptName": "%s"
             }
         }
    }"""

    # End of session. After this no more data should be sent.
    SESSION_END_EVENT = """{
        "event": {
            "sessionEnd": {}
        }
    }"""
#This will define the overall behaviour of the prompt what it expects the output as, audio config, all the available tools that nova sonic has like api calls and all everything is wrapped in an event. The prompt start  tells Nova sonic we are  starting a new prompt conversation turn 
    def start_prompt(self):
        """Create a promptStart event"""
        guest_tool_schema = json.dumps(
            {
                "type": "object",
                "properties": {
                    "guestName": {
                        "type": "string",
                        "description": "The full name of the hotel guest.",
                    },
                    "dateOfBirth": {
                        "type": "string",
                        "description": (
                            "The date of birth the guest SAID, converted to YYYY-MM-DD. "
                            "For example 'June fifth nineteen ninety one' becomes '1991-06-05'. "
                            "The tool compares this against our records and returns whether "
                            "identity is verified. Never guess this value - ask the guest."
                        ),
                    },
                },
                "required": ["guestName", "dateOfBirth"]
            }
        )

        reservation_tool_schema = json.dumps(
            {
                "type": "object",
                "properties": {
                    "guestName": {
                        "type": "string",
                        "description": "The full name of the hotel guest.",
                    },
                    "includePastStays": {
                         "type": "boolean",
                         "description": "If true, also return past stays.",
                         "default": False,
                    }
                },
                "required": ["guestName"]
            }
        )

        update_reservation_tool_schema = json.dumps(
            {
                "type": "object",
                "properties": {
                    "reservationId": {
                        "type": "string",
                        "description": "The reservation ID to update (e.g., 'RES-1001').",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["propose", "commit"],
                        "description": (
                            "Always call with 'propose' first: it returns the exact changes "
                            "WITHOUT writing anything, so you can read them back to the guest. "
                            "Only after the guest explicitly agrees, call again with 'commit' "
                            "and the proposalId you were given. Defaults to 'propose'."
                        ),
                    },
                    "proposalId": {
                        "type": "string",
                        "description": (
                            "Required for mode='commit'. Use the exact proposalId returned by "
                            "the preceding 'propose' call. Never invent one."
                        ),
                    },
                    "newRoomType": {
                        "type": "string",
                        "description": "New room type to set (e.g., 'King Deluxe'). Optional."
                    },
                    "newCheckOutDate": {
                        "type": "string",
                        "description": (
                            "A new check-out date in YYYY-MM-DD format. Use this when the guest "
                            "asks to extend or shorten their stay. Do NOT record a date change "
                            "as a special request. Optional."
                        ),
                    },
                    "newSpecialRequest": {
                        "type": "string",
                        "description": "A short note to append to specialRequests, e.g. 'Feather-free pillows'. Optional.",
                    },
                },
                "required": ["reservationId"],
            }
        )
        # "sampleRateHertz": 24000, slighly better than input when voice is talking to us which gives clear and crispy voice 
        # voice_id is mathew
        prompt_start_event = {
            "event": {
                "promptStart": {
                    "promptName": self.prompt_name,
                    "textOutputConfiguration": {"mediaType": "text/plain"},
                    "audioOutputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 24000, 
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "voiceId": "matthew",
                        "encoding": "base64",
                        "audioType": "SPEECH",
                    },
                    "toolUseOutputConfiguration": {"mediaType": "application/json"},
                    "toolConfiguration": {
                        "tools": [
                            {
                                "toolSpec": {
                                    "name": "checkGuestProfileTool",
                                    "description": (
                                        "Verify a guest's identity. Pass the guest's name AND the date of birth "
                                        "they spoke. The tool compares it against our records and returns "
                                        "verified true or false. It does NOT return the stored date of birth. "
                                        "If verified is false, you must not disclose any reservation or billing "
                                        "details - the other tools will refuse to run."
                                    ),
                                    "inputSchema": {"json": guest_tool_schema},
                                }
                            },
                            {
                                "toolSpec": {
                                    "name": "checkReservationStatusTool",
                                    "description": (
                                        "Use this tool to check the guest's upcoming reservation and, optionally, past stays. "
                                        "Call this after verifying identity to answer questions about bookings or balances."
                                    ),
                                    "inputSchema": {"json": reservation_tool_schema},
                                }
                            },
                            {
                                "toolSpec": {
                                    "name": "updateReservationTool",
                                    "description": (
                                        "Update an existing reservation. This is a TWO-STEP tool. "
                                        "Step 1: call with mode='propose' - it writes nothing and returns the exact "
                                        "changes plus a proposalId. Read those changes back to the guest verbatim. "
                                        "Step 2: only if the guest agrees, call with mode='commit' and that proposalId. "
                                        "Nothing is saved until the commit call succeeds."
                                    ),
                                    "inputSchema": {
                                        "json": update_reservation_tool_schema
                                    },
                                }
                            },
                        ]
                    },
                }
            }
        }

        return json.dumps(prompt_start_event)

    # builds the tool result event that you send back to nova sonic after your python code finishes running the tool.Main part is content that is the actual tool result dictionary that built from dynamodb, content_name is a unique id you assign to the tool result content block, you can add role to tell who is speaking
    def tool_result_event(self,content_name, content, role):
        """Create a tool result event"""

        if isinstance(content,dict):
            content_json_string = json.dumps(content)
        else:
            content_json_string = content

        tool_result_event = {
            "event": {
                "toolResult": {
                    "promptName": self.prompt_name,
                    "contentName": content_name,
                    "content": content_json_string
                }
            }
        }

        return json.dumps(tool_result_event)

    def __init__(self, model_id="amazon.nova-sonic-v1:0",region="us-east-1"):
        """Initialize the stream manager"""
        self.model_id = model_id
        self.region = region

        # Replace RxPy subject with asyncio queues
        self.audio_input_queue = asyncio.Queue() # Acts as a buffer between the microphone and Bedrock.  # The microphone thread immediately puts raw audio chunks into this queue. # Async tasks read chunks from the queue and stream them to Bedrock. # If the network slows down, audio temporarily accumulates in the queue # instead of being dropped, helping prevent data loss. 
        self.audio_output_queue = asyncio.Queue() # Acts as a playback buffer for audio received from Nova Sonic. Incoming audio chunks are placed into this queue before being played.  The speaker task reads chunks from the queue and plays them in order. This ensures smooth playback even if Nova Sonic sends audio at irregular intervals or with varying network latency.
        self.output_queue = asyncio.Queue() # General-purpose queue for non-audio events. The main loop places events (e.g., transcripts, metadata, UI updates, or logs) into this queue and immediately resumes processing audio. Separate async tasks consume these events independently, preventing on-audio work from blocking the real-time audio pipeline.

        self.response_task = None  # Will later store the background async task that continuously listens for streaming responses from Amazon Nova Sonic (Bedrock).
        self.stream_response = None # Will hold the active Bedrock streaming connection/response object once the bidirectional stream is established.
        self.is_active = False # Indicates whether the voice session is currently active. When False, background tasks should stop processing.
        self.barge_in = False # Flag indicating whether the user has interrupted the assistant while it is speaking. Used to stop or flush the current audio playback.

        # Optional queue of structured UI events (transcripts, tool activity,
        # agent state). The terminal client leaves this as None and nothing is
        # produced; server.py assigns a queue and drains it to the browser.
        # Keeping it opt-in means the terminal path is unchanged, and an
        # unread queue can never grow without bound.
        self.ui_events = None
        self.bedrock_client = None # Placeholder for the Amazon Bedrock runtime client. It will be initialized later and used to communicate with Nova Sonic. Audio playback components

        # Audio playback components
        self.audio_player = None # Placeholder for the audio playback object. It will be initialized later and used to play the audio received from Nova Sonic through the speakers. 

        # Text response components
        self.display_assistant_text = False # Controls whether the assistant's generated text should be displayed in the console or UI as it is streamed.
        self.role = None # Stores the role associated with the current streamed message  (e.g., "assistant", "user", or "system").

        # Session information
        self.prompt_name = str(uuid.uuid4()) # Unique ID for the current prompt/request sent to Nova Sonic. Helps identify this prompt within the streaming session.
        self.content_name = str(uuid.uuid4()) # Unique ID for the current text content/message being exchanged.
        self.audio_content_name = str(uuid.uuid4()) # Unique ID for the current audio content being streamed. Used to track audio chunks belonging to the same utterance.
        self.toolUseContent = "" # Stores the content or arguments associated with a tool call requested by the model.
        self.toolUseId = "" # Stores the unique identifier of the current tool invocation. Used to match the tool's result with the model's request.
        self.toolName = "" # Stores the name of the tool the model wants to invoke (e.g., weather lookup, database search, etc.).

        # Add a tool processor
        self.tool_processor = ToolProcessor() # Handles tool calls (e.g., DynamoDB queries) requested by the model. Executes them asynchronously so tool execution doesn't block the real-time voice conversation.

        # Add tracking for in-progress tool calls
        self.pending_tool_tasks = {}  # keeps track of active asynchronous tool executions so they can be monitored or canceled if necessary (e.g., during a barge-in or session termination).


    def emit_ui_event(self, event_type, **fields):
        """
        Publish a structured event for the browser UI.

        A no-op when no queue is attached (the terminal client), so this can be
        called freely from the response loop without branching at each site.
        put_nowait is used deliberately: emitting must never block the audio
        path, and a dropped UI event is preferable to stalled speech.
        """
        if self.ui_events is None:
            return
        try:
            self.ui_events.put_nowait({"type": event_type, **fields})
        except asyncio.QueueFull:
            pass                                # UI is behind; drop rather than stall audio.

    def _initialize_client(self):
        """Initailize the Bedrock client."""
        config = Config(
               endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
               region = self.region,
               aws_credentials_identity_resolver = EnvironmentCredentialsResolver(),
        )
        self.bedrock_client = BedrockRuntimeClient(config=config)


    async def initialize_stream(self):
        """Initialize the bidirectional stream with Bedrock."""
        if not self.bedrock_client:
            self._initialize_client()

        try:
            self.stream_response = await time_it_async(
                "invoke_model_with_bidirectional_stream",
                lambda: self.bedrock_client.invoke_model_with_bidirectional_stream(
                    InvokeModelWithBidirectionalStreamOperationInput(
                        model_id = self.model_id 
                    )
                ),
            )
            self.is_active = True
            default_system_prompt = (
                "You are the virtual front desk assistant for a hotel. "
                "Clearly state that you are a virtual assistant who can help guests with questions "
                "about their reservations, balances, and simple changes like room type or special requests."
                "SECURITY:"
                "- Before giving any reservation or billing details, you MUST verify the guest's identity."
                "- Politely ask for their full name and date of birth."
                "- Call checkGuestProfileTool with BOTH the guest's name and the date of birth they spoke, "
                "  converted to YYYY-MM-DD format."
                "- The tool performs the comparison and returns a 'verified' field. Trust that field only."
                "- If verified is false, tell the guest the details do not match and ask them to try again. "
                "  Do NOT reveal any reservation, room, or billing information, and do NOT claim you verified them."
                "- Never state that you checked or matched a date of birth unless the tool returned verified true."
                "AFTER ID VERIFICATION:"
                "1. If they ask about an upcoming stay, room details, or balance, call checkReservationStatusTool "
                "   with their guestName. Use includePastStays=true only if they ask about previous stays."
                "2. To change a room type, check-out date, or add a special request: first find the "
                "   reservationId with checkReservationStatusTool. Then call updateReservationTool with "
                "   mode='propose' - this saves nothing. Read the returned changes back to the guest in "
                "   plain language and ask them to confirm. Only when they clearly agree, call the tool "
                "   again with mode='commit' and the proposalId you were given."
                "   Never say a change is saved until the commit call has returned success."
                "   Use newCheckOutDate for date changes - never record a date change as a special request."
                "3. Only report a change as done if the tool returned success. If the tool returns an error, "
                "   tell the guest exactly what failed. Never claim an update succeeded when it did not."
                "4. After updating, explain clearly what changed (e.g. new room type, new check-out date, or the special request you added)."
                "STYLE:"
                "- Be warm, professional, and BRIEF. This is a spoken phone conversation, not a chat window."
                "- Keep every reply to one or two short sentences unless the guest asks for full details."
                "- State your capabilities ONCE at the start. Never re-list what you can help with."
                "- Do not add closing pleasantries like 'Have a wonderful day' unless the guest is leaving."
                "- Confirm important details back to the guest before updating."
                "- Do not invent reservations or balances that are not in the database."
                "STOPPING:"
                "- If the guest says stop, be quiet, that's enough, never mind, or similar, reply with AT "
                "  MOST three words - for example 'Of course.' - and then say nothing further."
                "- Do not explain that you are stopping. Do not apologise at length. Do not offer more help. "
                "  Do not ask a follow-up question. Saying more is the opposite of stopping."
                "- Then wait silently until the guest speaks again."
                "- Stopping applies ONLY to the reply you were giving. It is not a refusal and not the end "
                "  of the conversation. When the guest asks something new, answer it normally and fully."
                "- Once a guest is verified, never refuse their own reservation details on confidentiality "
                "  grounds, and never refuse to repeat something you already told them. They are verified; "
                "  their own booking is not confidential from them."
            )

            # Send the initialization events
            prompt_event = self.start_prompt() 
            text_content_start = self.TEXT_CONTENT_START_EVENT % (
                    self.prompt_name,
                    self.content_name,
                    "SYSTEM",
            )

            text_content = self.TEXT_INPUT_EVENT % (
                self.prompt_name,
                self.content_name,
                default_system_prompt,
            )
            text_content_end = self.CONTENT_END_EVENT % (
                self.prompt_name,
                self.content_name,
            )

            init_events = [
                self.START_SESSION_EVENT,
                prompt_event,
                text_content_start,
                text_content,
                text_content_end,
            ]

            # Send each initialization JSON event to the open bidirectional
            # Bedrock stream in the required order. A small delay between
            # events gives the service time to process each initialization
            # message before the next one arrives.
            for event in init_events:
                await self.send_raw_event(event)
                # Small delay between init events
                await asyncio.sleep(0.1)
            # After this model is reddy to chat


            # Start listening for responses
            # Starts a background async task that continuously listens for
            # streamed responses from Nova Sonic (audio, text, tool calls,
            # and other events). The returned task object is stored so it
            # can be monitored, awaited, or cancelled later.
            self.response_task = asyncio.create_task(self._process_responses())  
            

            # Start processing audio input
            # Starts a background async task that continuously reads audio
            # chunks from audio_input_queue and streams them to Bedrock.
            # The task handle isn't stored because it runs independently
            # for the lifetime of the session and isn't explicitly awaited
            # or cancelled by name
            asyncio.create_task(self.process_audio_input())

            # Wait a bit to ensure everything is set up
            await asyncio.sleep(0.1)

            debug_print("Stream initialized successfully")
            return self

        except Exception as e:
            self.is_active = False
            print(f"Failed to initialize stream: {str(e)}")
            raise

    async def send_raw_event(self, event_json):
        
        """Send a raw event JSON to the Bedrock stream."""
        if not self.stream_response or not self.is_active:
            debug_print("Stream not initialized or closed")
            return

        # Wraps the JSON event into the Bedrock SDK's InvokeModelWithBidirectionalStreamInputChunk object.
        # The Bedrock streaming API expects the payload as UTF-8 bytes,
        # so event_json is encoded before being wrapped.
        event = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=event_json.encode("utf-8"))
        )

        try:
            await self.stream_response.input_stream.send(event)
            # For debugging large events, you might want to log just the type
            if DEBUG:
                if len(event_json) > 200:
                    event_type = json.loads(event_json).get("event",{}).keys()
                    debug_print(f"Sent event type: {list(event_type)}")
                else:
                    debug_print(f"Sent event: {event_json}")
        except Exception as e:
            debug_print(f"Error sending event: {str(e)}")
            if DEBUG:
                import traceback

                traceback.print_exc()

    async def send_audio_content_start_event(self):
        """Send a content start event to the Bedrock stream."""
        content_start_event = self.CONTENT_START_EVENT % (
            self.prompt_name,
            self.audio_content_name
        )
        await self.send_raw_event(content_start_event) # Notifies Nova Sonic that a new content stream has started.

    async def process_audio_input(self):
        """Process audio input from the queue and send to Bedrock."""
        while self.is_active:
            try:
                # Get audio data from the queue
                data = await self.audio_input_queue.get()# Waits asynchronously for the next audio chunk placed into audio_input_queue by the microphone callback.

                audio_bytes = data.get("audio_bytes")
                if not audio_bytes:
                    debug_print("No audio bytes received")
                    continue

                # Base64 encode the audio data
                blob = base64.b64encode(audio_bytes)
                audio_event = self.AUDIO_EVENT_TEMPLATE % (
                    self.prompt_name,
                    self.audio_content_name,
                    blob.decode("utf-8"),
                )  

                # Send the event
                await self.send_raw_event(audio_event)

            except asyncio.CancelledError:
                break
            except Exception as e:
                debug_print(f"Error processing audio: {e}")
                if DEBUG:
                    import traceback

                    traceback.print_exc()

    # Producer side for the microphone audio queue. As soon as the microphone captures an audio chunk, it immediately places it into audio_input_queue using put_nowait(). A background consumer (process_audio_input) later reads these chunks and streams them to Nova Soni
    def add_audio_chunk(self, audio_bytes):
        """Add an audio chunk to the queue."""
        self.audio_input_queue.put_nowait(
            {
                "audio_bytes": audio_bytes,
                "prompt_name": self.prompt_name,
                "content_name": self.audio_content_name,
            }
        )

    async def send_audio_content_end_event(self):
        """Send a content end event to the Bedrock stream. """

        if not self.is_active:
            debug_print("Stream is not active")
            return

        content_end_event = self.CONTENT_END_EVENT % (
            self.prompt_name,
            self.audio_content_name,
        )
        await self.send_raw_event(content_end_event)
        debug_print("Audio ended")

    async def send_tool_start_event(self, content_name, tool_use_id):
        """Send a tool content start event to the Bedrock stream."""
        content_start_event = self.TOOL_CONTENT_START_EVENT % (
            self.prompt_name,
            content_name,
            tool_use_id,
        )
        debug_print(f"Sending tool start event: {content_start_event}")
        await self.send_raw_event(content_start_event)

    async def send_tool_result_event(self, content_name, tool_result):
        """Send a tool content event to the Bedrock stream."""
        # Use the actual tool result from processToolUse
        tool_result_event = self.tool_result_event(
            content_name=content_name, content=tool_result, role="TOOL"
        )
        debug_print(f"Sending tool result event: {tool_result_event}")
        await self.send_raw_event(tool_result_event)

    async def send_tool_content_end_event(self, content_name):
        """Send a tool content event to the Bedrock stream."""
        tool_content_end_event = self.CONTENT_END_EVENT % (
            self.prompt_name,
            content_name
        )
        debug_print(f"Sending tool content event: {tool_content_end_event}")
        await self.send_raw_event(tool_content_end_event)

    async def send_prompt_end_event(self):
        """Close the stream and clean up resources."""
        if not self.is_active:
            debug_print("Stream is not active")
            return

        prompt_end_event = self.PROMPT_END_EVENT % (
            self.prompt_name
        )
        await self.send_raw_event(prompt_end_event)
        debug_print("Prompt ended")

    async def send_session_end_event(self):
        """Send a session end event to the Bedrock stream."""
        if not self.is_active:
            debug_print("Stream is not active")
            return

        await self.send_raw_event(self.SESSION_END_EVENT)
        self.is_active = False
        debug_print("Session ended")

    # Continuously listens for responses coming back from Amazon Bedrock/Nova Sonic.
    # It reads each streamed response, identifies the event type, and routes
    # text, audio, tool calls, usage information, and errors to the proper place.
    async def _process_responses(self):

        # Short description of the method.
        """Process incoming responses from Bedrock."""

        try:
            # Keep listening while the bidirectional stream is active.
            while self.is_active:
                try:
                    # Wait until Bedrock produces the next output event.
                    output = await self.stream_response.await_output()

                    # Read the actual streamed payload from the returned output object.
                    result = await output[1].receive()

                    # Continue only when the result contains a value and byte data.
                    if result.value and result.value.bytes_:
                        try:
                            # Convert the UTF-8 byte payload into a normal Python string.
                            response_data = result.value.bytes_.decode("utf-8")

                            # Convert the JSON string into a Python dictionary.
                            json_data = json.loads(response_data)

                            # Bedrock responses contain their response type inside "event".
                            if "event" in json_data:

                                # completionStart means Nova Sonic has started generating
                                # a new response sequence.
                                if "completionStart" in json_data["event"]:
                                    debug_print(
                                    f"completionStart: {json_data['event']}"
                                    )

                                # contentStart means a new content block is beginning.
                                elif "contentStart" in json_data["event"]:
                                    debug_print("Content start detected")

                                    # Extract the contentStart event details.
                                    content_start = json_data["event"]["contentStart"]

                                    # Save whether this content belongs to the USER,
                                    # ASSISTANT, or another role.
                                    self.role = content_start["role"]

                                    # Check whether Nova Sonic included additional
                                    # model-generation metadata.
                                    if "additionalModelFields" in content_start:
                                        try:
                                            # additionalModelFields is itself a JSON
                                            # string, so parse it into a dictionary.
                                            additional_fields = json.loads(
                                                content_start["additionalModelFields"]
                                            )

                                            # Check whether this response is speculative
                                            # content generated before final confirmation.
                                            if (
                                                additional_fields.get("generationStage")
                                                == "SPECULATIVE"
                                            ):
                                                debug_print(
                                                    "Speculative content detected"
                                                )

                                                # Allow assistant text to be printed.
                                                self.display_assistant_text = True
                                            else:
                                                # Allow normal assistant text to be printed.
                                                self.display_assistant_text = True

                                        # Handle malformed JSON inside additionalModelFields.
                                        except json.JSONDecodeError:
                                            debug_print(
                                                "Error parsing additionalModelFields"
                                            )

                                # textOutput contains a transcription or generated text
                                # from the user or assistant.
                                elif "textOutput" in json_data["event"]:
                                    # Extract the actual text.
                                    text_content = json_data["event"]["textOutput"][
                                        "content"
                                    ]

                                    # Extract the speaker role for this text event.
                                    role = json_data["event"]["textOutput"]["role"]

                                    # Nova Sonic sends this marker when the user interrupts
                                    # the assistant while it is speaking.
                                    if '{"interrupted": true}' in text_content:
                                        debug_print(
                                          "Barge-in detected. Stopping audio output."
                                        )

                                        # Tell the audio playback component that the
                                        # current assistant audio should be stopped.
                                        self.barge_in = True

                                        # Let the UI reflect the interruption too.
                                        self.emit_ui_event("state", value="listening",
                                                           reason="barge_in")

                                    # Print assistant text only when assistant-text
                                    # display is enabled.
                                    if (
                                        role == "ASSISTANT"
                                        and self.display_assistant_text
                                    ):
                                        print(f"Assistant: {text_content}")

                                        # The interruption marker is protocol noise,
                                        # not speech - never show it as a transcript line.
                                        if '"interrupted"' not in text_content:
                                            self.emit_ui_event(
                                                "transcript",
                                                role="assistant",
                                                text=text_content,
                                                final=True,
                                            )
                                            self.emit_ui_event("state", value="speaking")

                                    # Print the user's transcribed speech.
                                    elif role == "USER":
                                        print(f"User: {text_content}")
                                        self.emit_ui_event(
                                            "transcript",
                                            role="user",
                                            text=text_content,
                                            final=True,
                                        )
                                        self.emit_ui_event("state", value="processing")

                                # audioOutput contains Nova Sonic's generated speech.
                                elif "audioOutput" in json_data["event"]:
                                    # Extract the Base64-encoded audio string.
                                    audio_content = json_data["event"]["audioOutput"][
                                        "content"
                                    ]

                                    # Decode the Base64 string into raw PCM audio bytes.
                                    audio_bytes = base64.b64decode(audio_content)

                                    # Place the audio bytes into the playback queue.
                                    # A separate audio-output task reads this queue
                                    # and plays the assistant's voice.
                                    await self.audio_output_queue.put(audio_bytes)

                                # toolUse means the model wants the application to
                                # execute an external tool or function.
                                elif "toolUse" in json_data["event"]:
                                    # Save the complete tool-request content.
                                    self.toolUseContent = json_data["event"]["toolUse"]

                                    # Save the requested tool's name.
                                    self.toolName = json_data["event"]["toolUse"][
                                        "toolName"
                                    ]

                                    # Save the unique ID used to match the tool result
                                    # with this specific request.
                                    self.toolUseId = json_data["event"]["toolUse"][
                                        "toolUseId"
                                    ]

                                    # Log which tool Nova Sonic requested.
                                    debug_print(
                                        f"Tool use detected: {self.toolName}, "
                                        f"ID: {self.toolUseId}"
                                    )

                                # contentEnd with type TOOL means the model has finished
                                # streaming all information needed for the tool request.
                                elif (
                                    "contentEnd" in json_data["event"]
                                    and json_data["event"]
                                    .get("contentEnd", {})
                                    .get("type")
                                    == "TOOL"
                                ):
                                    debug_print(
                                        "Processing tool use asynchronously"
                                    )

                                    # Start tool execution in a background task so this
                                    # response listener can continue receiving events.
                                    # Start asynchronous tool processing - non-blocking
                                    self.handle_tool_request(
                                        self.toolName,
                                        self.toolUseContent,
                                        self.toolUseId,
                                    )

                                    # handle_tool_request should execute the tool and
                                    # send its result back to Nova Sonic.
                                    debug_print(
                                        "Tool request started asynchronously"
                                    )

                                # A normal contentEnd means the current text, audio,
                                # or content block has finished.
                                elif "contentEnd" in json_data["event"]:
                                    debug_print("Content end")

                                # completionEnd means Nova Sonic has finished the
                                # complete response sequence.
                                elif "completionEnd" in json_data["event"]:
                                    debug_print("End of response sequence")

                                # usageEvent contains usage information such as
                                # input tokens, output tokens, or related metrics.
                                elif "usageEvent" in json_data["event"]:
                                    debug_print(
                                        f"UsageEvent: {json_data['event']}"
                                    )

                            # Forward every successfully parsed response to another
                            # queue so other parts of the application can process it.
                            await self.output_queue.put(json_data)

                        # If the Bedrock payload is not valid JSON, preserve the
                        # original decoded string instead of discarding it.
                        except json.JSONDecodeError:
                            await self.output_queue.put(
                                {"raw_data": response_data}
                            )

                # Raised when the asynchronous Bedrock stream has no more events.
                except StopAsyncIteration:
                    # Exit the listening loop because the stream has ended.
                    break

                # Handle other errors that happen while receiving stream responses.
                except Exception as e:
                    # Bedrock may return ValidationException for invalid event
                    # structure, sequencing, configuration, or payload data.
                    if "ValidationException" in str(e):
                        error_message = str(e)
                        print(f"Validation error: {error_message}")
                    else:
                        # Print any unexpected stream-receiving error.
                        print(f"Error receiving response: {e}")

                    # Stop listening because the stream encountered an error.
                    break

        # Catch errors affecting the entire response-processing method.
        except Exception as e:
            print(f"Response processing error: {e}")

        finally:
            # Mark the stream inactive whether it ends normally or because of an error.
            self.is_active = False    
    
           

    def handle_tool_request(self, tool_name, tool_content, tool_use_id):
        """Handle a tool request asynchronously"""
        # Create a unique content name for this tool response
        tool_content_name = str(uuid.uuid4())

        # Create an asynchronous task for the task execution
        task = asyncio.create_task(
            self._execute_tool_and_send_result(
                tool_name, tool_content, tool_use_id, tool_content_name
            )
        )

        # Store the task
        self.pending_tool_tasks[tool_content_name]=task

        #Add error handling
        task.add_done_callback(
            lambda t: self._handle_tool_task_completion(t,tool_content_name)
        )


    def _handle_tool_task_completion(self, task, content_name):
        """Handle the completion of a tool task"""
        # Remove task from pending task
        if content_name in self.pending_tool_tasks:
            del self.pending_tool_tasks[content_name]

        # Handle any exceptions
        if task.done() and not task.cancelled():
            exception = task.exception()
            if exception:
                debug_print(f"Tool task failed: {str(exception)}")
        



    async def _execute_tool_and_send_result(
        self, tool_name, tool_content, tool_use_id, content_name
    ):
        """Execute a tool and send the result"""
        try:
            debug_print(f"Starting tool execution: {tool_name}")

            # Announce the call before running it, so the UI can show the tool
            # as in-flight rather than only after it finishes. Arguments are
            # sanitised: the model passes a spoken date of birth here.
            started = time.perf_counter()
            # tool_content["content"] arrives as a JSON *string*, so it must be
            # parsed before sanitising - handing the raw string to the sanitiser
            # returns it untouched and leaks the spoken date of birth to the UI.
            raw_args = tool_content.get("content", {})
            if isinstance(raw_args, str):
                try:
                    raw_args = json.loads(raw_args)
                except json.JSONDecodeError:
                    raw_args = {"raw": "[unparseable]"}   # Never emit an unparsed blob.

            self.emit_ui_event(
                "tool_call",
                id=tool_use_id,
                name=tool_name,
                args=sanitize_for_ui(raw_args),
            )
            self.emit_ui_event("state", value="executing_tool", tool=tool_name)

            # Process the tool - this doesn't block the event loop
            tool_result = await self.tool_processor.process_tool_async(
                tool_name, tool_content
            )

            latency_ms = round((time.perf_counter() - started) * 1000, 1)

            # A tool that returns an "error" key ran successfully but refused -
            # a rejected room type or an unverified caller. That is a failed
            # outcome from the guest's point of view, so report it as one.
            ok = not (isinstance(tool_result, dict) and tool_result.get("error"))

            self.emit_ui_event(
                "tool_result",
                id=tool_use_id,
                name=tool_name,
                ok=ok,
                latencyMs=latency_ms,
                result=sanitize_for_ui(tool_result),
            )

            # A proposal is the read-back step of a two-phase write. Surface it
            # separately so the UI can render a confirmation card rather than
            # burying it in the tool trace.
            if isinstance(tool_result, dict) and tool_result.get("mode") == "proposal":
                self.emit_ui_event(
                    "proposal",
                    proposalId=tool_result.get("proposalId"),
                    reservationId=tool_result.get("reservationId"),
                    changes=sanitize_for_ui(tool_result.get("changes", [])),
                )

            # Send the result sequence
            await self.send_tool_start_event(content_name, tool_use_id)
            await self.send_tool_result_event(content_name, tool_result)
            await self.send_tool_content_end_event(content_name)

            debug_print(f"Tool execution complete: {tool_name}")
        except Exception as e:
            debug_print(f"Error executing tool {tool_name}: {str(e)}")
            self.emit_ui_event(
                "tool_result", id=tool_use_id, name=tool_name,
                ok=False, latencyMs=None, result={"error": str(e)},
            )
            # Try to send an error response if possible
            try:
                error_result = {"error": f"Tool execution failed: {str(e)}"}

                await self.send_tool_start_event(content_name, tool_use_id)
                await self.send_tool_result_event(content_name,error_result)
                await self.send_tool_content_end_event(content_name)
            except Exception as send_error:
                debug_print(f"Failed to send error response: {str(send_error)}")


    async def close(self):
        """Close the stream properly"""
        if not self.is_active:
            return

        # Cancel any pending tool tasks
        for task in self.pending_tool_tasks.values():
            task.cancel()

        if self.response_task and not self.response_task.done():
            self.response_task.cancel()

        await self.send_audio_content_end_event()
        await self.send_prompt_end_event()
        await self.send_session_end_event()

        if self.stream_response:
            await self.stream_response.input_stream.close()


class AudioStreamer:
    """Handles continuous microphone input and audio output using seaparte streams."""

    def __init__(self,stream_manager):
        self.stream_manager = stream_manager  
        # Keep a reference to the Bedrock stream manager so microphone audio and other events can be sent to Bedrock.

        self.is_streaming = False  
        # Indicates whether audio streaming is currently active. It is set to True when streaming starts.

        self.loop = asyncio.get_event_loop()  
        # Get a reference to the asyncio event loop so synchronous code (such as microphone callbacks running in another thread)
        # can safely schedule async tasks onto the main event loop.
        
        # Initialize PyAudio
        debug_print("AudioStreamer Initializing PyAudio...")
        self.p = time_it("AudioStreamer Initializing PyAudio...", pyaudio.PyAudio)
        debug_print("AudioStreamer PyAudio initialized")

        # Initialize separate streams for input and output
        # Input stream with callback for microphone
        debug_print("Opening input audio stream...")
        self.input_stream = time_it(
            "AudioStreamerOpenAudio",
            lambda: self.p.open(
                format= FORMAT,
                channels = CHANNELS,
                rate=INPUT_SAMPLE_RATE,
                input = True,
                frames_per_buffer = CHUNK_SIZE,
                stream_callback=self.input_callback,
            ),
        ) 
        # Opens a microphone input stream using the specified audio format, sample rate,
        # channels, and chunk size. Whenever a new audio chunk is captured, PyAudio
        # automatically calls `self.input_callback`.
        debug_print("input audio stream opened")

        # Ouput stream for direct writing (no callback)
        debug_print("Opening output audio stream...")
        # Open an output (speaker) audio stream. No stream_callback is needed because
        # our code manually writes audio received from Nova Sonic/Bedrock to the speaker
        # using output_stream.write(audio_bytes).
        self.output_stream = time_it(
            "AudioStreamerOpenAudio",
            lambda: self.p.open(
                format = FORMAT,
                channels=CHANNELS,
                rate = OUTPUT_SAMPLE_RATE,
                output = True,
                frames_per_buffer = CHUNK_SIZE,
            ),
        ) 

        debug_print("ouput audio stream opened")

    # PyAudio calls this function automatically whenever a new microphone audio chunk is available.
    # It runs in PyAudio's own thread, not in the asyncio event loop.
    def input_callback(self, in_data, frame_count, time_info, status):
        """Callback function that schedules audio processing in the asyncio event loop"""

        # Only process audio if streaming is active and audio data was received.
        if self.is_streaming and in_data:
            # Thread-safe bridge:
            # This submits the async coroutine to the asyncio event loop
            # because this callback is running in a different (PyAudio) thread.
            asyncio.run_coroutine_threadsafe(
                self.process_input_audio(in_data),  # Coroutine that processes/sends the audio chunk
                self.loop                           # The asyncio event loop where it should run
            )

        # Tell PyAudio to keep the microphone stream running.
        return (None, pyaudio.paContinue)

    async def process_input_audio(self, audio_data):
        """Process a single audio chunk directly"""
        try:
            # Send audio to Bedrock immediately
            self.stream_manager.add_audio_chunk(audio_data)
        except Exception as e:
            if self.is_streaming:
                print(f"Error processing input audio: {e}")

  
    async def play_output_audio(self):
        """Play audio responses from Nova Sonic"""
        while self.is_streaming:
            try:
                # Check for barge-in flag
                if self.stream_manager.barge_in:
                    # Clear the audio queue
                    while not self.stream_manager.audio_output_queue.empty():
                        try:
                            self.stream_manager.audio_output_queue.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                    self.stream_manager.barge_in = False
                    # Small sleep after clearing
                    await asyncio.sleep(0.05)
                    continue

                # Get audio data from the stream manager's queue
                audio_data = await asyncio.wait_for(
                    self.stream_manager.audio_output_queue.get(), timeout=0.1
                )

                if audio_data and self.is_streaming:
                    # Write directly to the output stream in smaller chunks
                    chunk_size = CHUNK_SIZE # Use the same chunk size as the stream

                    # Write the audio data in chunks to avoid blocking too long
                    for i in range(0, len(audio_data), chunk_size):
                        if not self.is_streaming:
                            break

                        end = min(i+chunk_size, len(audio_data))
                        chunk = audio_data[i:end]

                        # Create a new function that captures the chunk by value
                        def write_chunk(data):
                            return self.output_stream.write(data)

                        # Pass the chunk to the function 
                        await asyncio.get_event_loop().run_in_executor(
                            None, write_chunk,chunk
                        )

                        # Brief yield to allow other tasks to run
                        await asyncio.sleep(0.001)

            except asyncio.TimeoutError:
                # No data available within timeout, just co0ntinue
                continue
            except Exception as e:
                if self.is_streaming:
                    print(f"Error playing output audio: {str(e)}")
                    import traceback

                    traceback.print_exc()
                await asyncio.sleep(0.05)

    async def start_streaming(self):
        """Start streaming audio."""
        if self.is_streaming:
            return

        print("Starting audio streaming. Speak into your microphone...")
        print("Press Enter to stop streaming...")

        # Send audio content start event
        await time_it_async(
            "send_audio_content_start_event",
            lambda: self.stream_manager.send_audio_content_start_event(),
        )

        self.is_streaming = True

        # Start the input stream if not already started
        if not self.input_stream.is_active():
            self.input_stream.start_stream()

        # Start processing task
        # self.input_task = asyncio.create_task(self.process_input_audio())
        self.output_task = asyncio.create_task(self.play_output_audio())

        # Wait for user to press Enter to stop
        await asyncio.get_event_loop().run_in_executor(None,input)

        # Once input() returns, stop streaming
        await self.stop_streaming()

    async def stop_streaming(self):
        """Stop streaming audio."""
        if not self.is_streaming:
            return

        self.is_streaming = False

        # Cancel the tasks
        tasks = []
        if hasattr(self, "input_task") and not self.input_task.done():
            tasks.append(self.input_task)
        if hasattr(self, "output_task") and not self.output_task.done():
            tasks.append(self.output_task)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        # Stop and close the streams
        if self.input_stream:
            if self.input_stream.is_active():
                self.input_stream.stop_stream()
            self.input_stream.close()
        if self.output_stream:
            if self.output_stream.is_active():
                self.output_stream.stop_stream()
            self.output_stream.close()
        if self.p:
            self.p.terminate()

        await self.stream_manager.close()



async def main(debug=False):
    """Main function to run the application."""
    global DEBUG
    DEBUG = debug

    # Create stream manager
    stream_manager = BedrockStreamManager(
        model_id="amazon.nova-sonic-v1:0", region="us-east-1"
    )

    # Create audio streamer
    audio_streamer = AudioStreamer(stream_manager)

    # Initialize the stream
    await time_it_async("initialize_stream", stream_manager.initialize_stream)

    try:
        # This will run until the user presses Enter
        await audio_streamer.start_streaming()

    except KeyboardInterrupt:
        print("Interrupted by user")
    finally:
        # Clean up
        await audio_streamer.stop_streaming()


if __name__=="__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Nova Sonic Python Streaming")
    parser.add_argument("--debug",action="store_true",help="Enable debug mode")
    args = parser.parse_args()
    # Set yor AWS credentials here or use environement variables

    # Run the main function
    try:
        asyncio.run(main(debug=args.debug))
    except Exception as e:
        print(f"Application error: {e}")
        if args.debug:
            import traceback

            traceback.print_exc()









    


    







    



    





















    

    

    
            





    

        