import { ImageResponse } from "next/og";

export const alt = "Firstreply: answer every lead in under a minute. A stopwatch reads 00:48.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand colours from docs/spec.md section 5, as hex: next/og cannot read CSS variables.
const night = "#13161C";
const cream = "#FBF7EE";
const coral = "#E4573D";
const sea = "#1F7A8C";

/** Each character of the timer sits in a fixed-width cell, so the default sans reads as a stopwatch. */
function Timer({ value }: { value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {value.split("").map((ch, i) => (
        <div
          key={i}
          style={{
            width: ch === ":" ? 40 : 88,
            display: "flex",
            justifyContent: "center",
            fontSize: 140,
            fontWeight: 600,
            lineHeight: 1,
            color: night,
          }}
        >
          {ch}
        </div>
      ))}
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px",
          background: cream,
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(19, 22, 28, 0.12) 1.5px, transparent 0)",
          backgroundSize: "24px 24px",
          color: night,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>Firstreply</div>
          <div style={{ width: 18, height: 18, borderRadius: 999, background: coral, marginTop: 2 }} />
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 520 }}>
            <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.03em" }}>
              Answer every lead in under a minute.
            </div>
            <div style={{ marginTop: 28, fontSize: 26, lineHeight: 1.35, color: "#3B4049" }}>
              Scored against your rubric, replied to with three real slots, booked when they pick one.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              padding: "28px 36px",
              background: "#FFFFFF",
              borderRadius: 32,
              border: "2px solid rgba(19, 22, 28, 0.1)",
            }}
          >
            <Timer value="00:48" />
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
              <div style={{ width: 14, height: 14, borderRadius: 999, background: sea }} />
              <div style={{ fontSize: 24, fontWeight: 600, color: "#3B4049" }}>first reply drafted</div>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
