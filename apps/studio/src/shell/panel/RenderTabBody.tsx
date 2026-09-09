import { ReferenceBar } from "./ReferenceBar";

interface RenderTabBodyProps {
  prompt: string;
  onPromptChange: (value: string) => void;
}

export function RenderTabBody({ prompt, onPromptChange }: RenderTabBodyProps) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="prompt-heading"><p>Prompt <span>(optional)</span></p><button type="button">Try example</button></div>
      <textarea
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="Example: A modern house with a wood cladding located by the Swedish coast and surrounding pine trees"
        className="min-h-[140px] flex-1 resize-none rounded-lg border border-hairline p-3 text-sm text-primary placeholder:text-faint focus:border-blueprint focus:outline-none"
      />
      <div className="studio-advanced">
        <strong>Advanced settings <span>⌃</span></strong>
        <label><span>Style influence</span><input type="range" min="1" max="4" defaultValue="2" /><b>2</b></label>
        <label><span>Preserve structure<small>Keep openings and camera angle intact</small></span><input type="checkbox" defaultChecked /></label>
        <button type="button"><span>▧</span><p>Background reference<small>Landscape, lighting and surroundings</small></p><b>＋</b></button>
      </div>
      <div className="mt-2">
        <ReferenceBar />
      </div>
    </div>
  );
}
