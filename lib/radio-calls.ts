/**
 * The recorded walkie calls used in the demo. The audio is played for real and transcribed live
 * when an ElevenLabs key is set. `transcript` is what that service returned for each file, kept
 * as the fallback so the demo still works offline or without a key.
 */
export interface RadioCall {
  id: string;
  /** Short label for the demo chip. */
  label: string;
  file: string;
  transcript: string;
}

export const RADIO_CALLS: RadioCall[] = [
  {
    id: "heat",
    label: "Radio: heat exhaustion",
    file: "/radio/heat-exhaustion.mp3",
    transcript: "Control to medical. Dispatch a rover to main stage barrier. Patron showing signs of heat exhaustion. How copy? Over.",
  },
  {
    id: "intruder",
    label: "Radio: intruder at fence",
    file: "/radio/intruder.mp3",
    transcript:
      "Dispatch, unit four. We've got an unauthorized individual climbing the perimeter fence behind warehouse B, heading toward the loading bays. Male, dark jacket, carrying a crowbar. Need backup to intercept now",
  },
];
