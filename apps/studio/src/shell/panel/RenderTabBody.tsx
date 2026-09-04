import { ReferenceBar } from "./ReferenceBar";

interface RenderTabBodyProps {
  prompt: string;
  onPromptChange: (value: string) => void;
}

export function RenderTabBody({ prompt, onPromptChange }: RenderTabBodyProps) {
  return (
    <div className="flex flex-1 flex-col">
      <textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="Example: A modern house with a wood cladding located by the Swedish coast and surrounding pine trees"
        className="min-h-[140px] flex-1 resize-none rounded-lg border border-hairline p-3 text-sm text-primary placeholder:text-faint focus:border-blueprint focus:outline-none"
      />
      <div className="mt-2">
        <ReferenceBar />
      </div>
    </div>
  );
}
