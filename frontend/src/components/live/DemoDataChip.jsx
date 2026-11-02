// The static Pages build ships fixture KPIs and fixture incidents; the clip is a
// recording and only the opt-in browser engine produces real detections. One quiet chip
// marks the blocks a visitor could otherwise read as live telemetry, so the numbers never
// pass for telemetry. It is rendered only in the mock build: with a real API the data is
// genuine and needs no label.
export default function DemoDataChip({ title }) {
  return (
    <span
      title={title}
      className="shrink-0 text-[10px] font-mono font-bold normal-case px-1.5 py-0.5 rounded border bg-amber-50 text-amber-900 border-amber-300 dark:bg-[#FFEB33]/15 dark:text-[#FFEB33] dark:border-[#FFEB33]/40"
    >
      date demo
    </span>
  );
}
