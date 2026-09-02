import boto3
import datetime
import time
from decimal import Decimal
import os




def setup_demo_data():
    # Initialize DynamoDB resource
    # Make sure your AWS credentials are set in your environment
    dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
    
    # --- 1. Define Table Schemas ---
    tables = {
        'Hotel_Guests': {
            'KeySchema': [{'AttributeName': 'guestName', 'KeyType': 'HASH'}],
            'AttributeDefinitions': [{'AttributeName': 'guestName', 'AttributeType': 'S'}]
        },
        'Hotel_Reservations': {
            'KeySchema': [{'AttributeName': 'reservationId', 'KeyType': 'HASH'}],
            'AttributeDefinitions': [{'AttributeName': 'reservationId', 'AttributeType': 'S'}]
        }
    }

    # --- 2. Delete Old Tables & Create New Ones ---
    print("--- Resetting Database ---")
    for table_name, schema in tables.items():
        table = dynamodb.Table(table_name)
        
        # Delete if exists
        try:
            print(f"Deleting old table: {table_name}...")
            table.delete()
            table.wait_until_not_exists()
            print(f"Deleted {table_name}.")
        except Exception as e:
            # Verify if error is just "ResourceNotFoundException" (which is fine)
            if "ResourceNotFoundException" in str(e):
                pass
            else:
                print(f"Warning deleting {table_name}: {e}")
        
        # Create new
        print(f"Creating new table: {table_name}...")
        try:
            dynamodb.create_table(
                TableName=table_name,
                KeySchema=schema['KeySchema'],
                AttributeDefinitions=schema['AttributeDefinitions'],
                ProvisionedThroughput={'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5}
            )
            # Refresh table reference and wait for it to exist
            table = dynamodb.Table(table_name)
            table.wait_until_exists()
            print(f"Ready: {table_name}")
        except Exception as e:
            print(f"Error creating {table_name}: {e}")
            return

    # --- 3. Seed Guest Data ---
    #
    # Four guests, chosen so every branch the tools can take is reachable in a
    # live conversation:
    #
    #   Anna Smith    upcoming stay, fully paid          -> the happy path
    #   Mark Johnson  upcoming stay with a balance due   -> the balance branch
    #                 plus one past stay                 -> includePastStays
    #   Priya Raman   past stay only                     -> "no upcoming reservations"
    #   David Chen    profile but no bookings at all     -> "no reservations found"
    #
    # A name that is NOT in this table (say "John Doe") exercises the
    # found:False path in checkGuestProfileTool.
    print("\n--- Seeding Hotel Guests ---")
    guests = dynamodb.Table('Hotel_Guests')

    guests.put_item(Item={
        'guestName': 'Anna Smith',
        'dob': '1991-06-05',
        'loyaltyTier': 'Gold',
        'phoneNumber': '+1-555-111-2222',
        'email': 'anna.smith@example.com',
        'preferredLanguage': 'en-US',
        'preferredBedType': 'King',
        'preferredView': 'Sea',
        'vipFlag': True
    })

    guests.put_item(Item={
        'guestName': 'Mark Johnson',
        'dob': '1985-01-21',
        'loyaltyTier': 'Standard',
        'phoneNumber': '+1-555-333-4444',
        'email': 'mark.johnson@example.com',
        'preferredLanguage': 'en-US',
        'preferredBedType': 'Queen',
        'preferredView': 'City',
        'vipFlag': False
    })

    guests.put_item(Item={
        'guestName': 'Priya Raman',
        'dob': '1978-11-30',
        'loyaltyTier': 'Platinum',
        'phoneNumber': '+1-555-777-8888',
        'email': 'priya.raman@example.com',
        'preferredLanguage': 'en-US',
        'preferredBedType': 'King',
        'preferredView': 'Garden',
        'vipFlag': True
    })

    guests.put_item(Item={
        'guestName': 'David Chen',
        'dob': '1996-02-14',
        'loyaltyTier': 'Standard',
        'phoneNumber': '+1-555-222-9999',
        'email': 'david.chen@example.com',
        'preferredLanguage': 'en-US',
        'preferredBedType': 'Twin',
        'preferredView': 'City',
        'vipFlag': False
    })

    print("Guests seeded: Anna Smith (Gold/VIP), Mark Johnson (Standard),")
    print("               Priya Raman (Platinum/VIP), David Chen (Standard)")

    # --- 4. Seed Reservation Data ---
    print("\n--- Seeding Hotel Reservations ---")
    reservations = dynamodb.Table('Hotel_Reservations')

    today = datetime.date.today()
    def day(n):
        return (today + datetime.timedelta(days=n)).strftime('%Y-%m-%d')

    # A stay counts as upcoming when checkOutDate >= today AND status is
    # Confirmed or CheckedIn. Anna sits three days out rather than tomorrow so
    # there is room either side to move the check-out date during a demo.
    reservations.put_item(Item={
        'reservationId': 'RES-1001',
        'guestName': 'Anna Smith',
        'roomNumber': '1205',
        'roomType': 'King Deluxe',
        'checkInDate': day(3),
        'checkOutDate': day(6),
        'status': 'Confirmed',
        'paymentStatus': 'Paid',
        'balanceDue': Decimal('0.00'),
        'bookingChannel': 'Hotel Website',
        'specialRequests': ['High floor', 'Late check-out'],
        'eligibleForLateCheckout': True,
        'allowVoiceAgentChanges': True
    })

    # paymentStatus != Paid, so checkReservationStatusTool appends the balance
    # line to its spoken message.
    reservations.put_item(Item={
        'reservationId': 'RES-2001',
        'guestName': 'Mark Johnson',
        'roomNumber': '0803',
        'roomType': 'Queen Standard',
        'checkInDate': day(10),
        'checkOutDate': day(12),
        'status': 'Confirmed',
        'paymentStatus': 'DepositPaid',
        'balanceDue': Decimal('240.50'),
        'bookingChannel': 'Booking.com',
        'specialRequests': ['Airport pickup', 'Feather-free pillows'],
        'eligibleForLateCheckout': False,
        'allowVoiceAgentChanges': True
    })

    reservations.put_item(Item={
        'reservationId': 'RES-1999',
        'guestName': 'Mark Johnson',
        'roomNumber': '0502',
        'roomType': 'Queen Standard',
        'checkInDate': day(-10),
        'checkOutDate': day(-7),
        'status': 'CheckedOut',
        'paymentStatus': 'Paid',
        'balanceDue': Decimal('0.00'),
        'bookingChannel': 'Hotel Website',
        'specialRequests': ['Early check-in'],
        'eligibleForLateCheckout': False,
        'allowVoiceAgentChanges': False
    })

    # Priya has history but nothing booked, which is the only way to reach the
    # "You have no upcoming reservations." branch on a guest who does exist.
    reservations.put_item(Item={
        'reservationId': 'RES-1750',
        'guestName': 'Priya Raman',
        'roomNumber': '1502',
        'roomType': 'King Suite',
        'checkInDate': day(-30),
        'checkOutDate': day(-27),
        'status': 'CheckedOut',
        'paymentStatus': 'Paid',
        'balanceDue': Decimal('0.00'),
        'bookingChannel': 'Hotel Website',
        'specialRequests': ['Champagne on arrival'],
        'eligibleForLateCheckout': False,
        'allowVoiceAgentChanges': False
    })

    # David Chen deliberately has no rows at all.

    print("Reservations seeded:")
    print(" - RES-1001  Anna Smith    upcoming  King Deluxe     Paid          $0.00")
    print(" - RES-2001  Mark Johnson  upcoming  Queen Standard  DepositPaid   $240.50")
    print(" - RES-1999  Mark Johnson  past      Queen Standard  Paid")
    print(" - RES-1750  Priya Raman   past      King Suite      Paid")
    print(" - (David Chen has no reservations, on purpose)")

    print("\n--- Setup Complete ---")

if __name__ == '__main__':
    setup_demo_data()
