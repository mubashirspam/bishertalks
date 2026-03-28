export default function HeroScene() {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      {/* Dark orange/brown gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, #2d1810 0%, #1a0f08 30%, #100a06 60%, #080503 100%)",
        }}
      />
      {/* Subtle orange glow behind center (where the hero image sits) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 60%, rgba(249, 115, 22, 0.15) 0%, transparent 50%)",
        }}
      />
    </div>
  );
}
