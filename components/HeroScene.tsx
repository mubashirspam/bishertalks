export default function HeroScene() {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      {/* Dark blue/black gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, #0a1a2e 0%, #060f1f 30%, #040b18 60%, #020710 100%)",
        }}
      />
      {/* Subtle blue glow behind center (where the hero image sits) */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 60%, rgba(0, 212, 255, 0.12) 0%, transparent 50%)",
        }}
      />
    </div>
  );
}
