/**
 * The luminous field the workspace sits on.
 *
 * Four heavily blurred colour sources drifting on independent, mutually prime
 * cycles, so the composition never visibly repeats. They are composited with
 * `screen` so overlaps add light rather than muddying - that additive quality
 * is what makes it read as glow rather than as coloured paint.
 *
 * Real elements rather than a CSS gradient because only elements can be
 * transformed on the compositor; animating a background repaints the whole
 * viewport every frame.
 */
export function MeshBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ background: "var(--bg-canvas)" }}
    >
      <span className="glow glow-1" />
      <span className="glow glow-2" />
      <span className="glow glow-3" />
      <span className="glow glow-4" />

      {/* Grain over the light: without it, large blurred fields read as flat
          CSS gradients. */}
      <span className="glow-grain" />
    </div>
  );
}
