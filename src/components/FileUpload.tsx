import { useRef, useState } from "react";

interface Props {
  onFile: (text: string, name: string) => void;
}

export default function FileUpload({ onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => onFile(e.target?.result as string, file.name);
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 p-8">
      {/* Logo / title */}
      <div className="mb-10 text-center">
        <div className="text-5xl font-bold tracking-tight text-slate-100 mb-2">
          browser<span className="text-sky-400">CAN</span>
        </div>
        <div className="text-slate-500 text-sm">
          CAN Bus Frame Analyzer — GVRET / CSV
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`
          w-full max-w-lg border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer
          transition-all duration-200
          ${
            dragging
              ? "border-sky-400 bg-sky-900/20 scale-[1.02]"
              : "border-slate-700 hover:border-slate-500 bg-slate-900/50 hover:bg-slate-900"
          }
        `}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="text-4xl mb-4 select-none">📡</div>
        <p className="text-slate-300 font-medium mb-2">
          Drop your GVRET CSV file here
        </p>
        <p className="text-slate-500 text-sm mb-6">or click to browse</p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors">
          Choose file
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.log,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) readFile(file);
          }}
        />
      </div>

      {/* Format hint */}
      <div className="mt-8 max-w-lg w-full rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p className="text-xs text-slate-500 font-mono mb-2 text-slate-400">
          Expected CSV format (GVRET):
        </p>
        <pre className="text-xs text-slate-600 font-mono leading-relaxed overflow-x-auto">
          {`Time Stamp,ID,Extended,Remote Frame,DLC,D1,D2,D3,D4,D5,D6,D7,D8
9778,193,0,0,8,16,0,0,0,16,0,0,0
9779,313,0,0,8,0,64,0,0,0,0,0,0`}
        </pre>
      </div>
    </div>
  );
}
