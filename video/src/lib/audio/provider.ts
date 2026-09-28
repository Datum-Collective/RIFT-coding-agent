/**
 * Extension point for generated speech. The renderer only ever plays files from public/audio,
 * so any provider (ElevenLabs, Kokoro, a local model) plugs in by writing a file and returning
 * its path; no paid service is needed to render a video without a voice.
 */
export type VoiceoverRequest = {
  text: string;
  voice?: string;
  /** Where to write the audio, relative to public/, e.g. "audio/rift-launch-vo.mp3". */
  output: string;
};

export type VoiceoverResult = {
  /** Relative to public/; use it as spec.audio.voiceover.src. */
  src: string;
  durationInSeconds: number;
  /** Word timings when the provider returns them, ready for spec.captions.items. */
  words?: { text: string; startMs: number; endMs: number }[];
};

export interface VoiceoverProvider {
  readonly name: string;
  synthesize(request: VoiceoverRequest): Promise<VoiceoverResult>;
}
