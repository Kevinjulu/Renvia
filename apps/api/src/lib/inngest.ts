import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "renvia-api" });

export interface RenderRequestedEvent {
  name: "render/requested";
  data: {
    renderId: string;
  };
}
