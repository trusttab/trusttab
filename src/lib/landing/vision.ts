/**
 * Where this could go, beyond the five stages.
 *
 * Kept separate from `stages.ts` deliberately. The five stages are one
 * pipeline — detection, verification, identity, authorization, protection —
 * and these are different surfaces rather than further steps along it. Folding
 * them into the stage list would blur a narrative the page is careful about,
 * and would break the assertion that exactly one stage is unshipped.
 *
 * Everything here is held to the same rule as the Protection stage: no
 * present-tense claim that TrustTab does any of it. `vision.test.ts` applies
 * the same verb blocklist, and additionally forbids dates and commitment
 * language, because a vision section is exactly where a roadmap promise would
 * creep in.
 *
 * Note on wording: the blocklist doesn't catch "protecting", only "protects".
 * The gerund is avoided here anyway. Passing a check by finding a gap in it
 * isn't the standard this page is held to.
 */

export type VisionArea = {
  name: string;
  body: string;
};

/**
 * Shown above the areas. Says plainly what this section is, because a list of
 * future-sounding capabilities with no framing reads as a roadmap however it
 * is worded.
 */
export const VISION_INTRO =
  "None of this exists, and none of it is being worked on. It isn't a roadmap — there are no dates and no commitments. It's the shape of the problem as we currently understand it, written down so the direction is legible rather than implied.";

export const VISION_AREAS: VisionArea[] = [
  {
    name: "AI voice calls",
    body: "An AI voice agent on a phone call poses the same trust question as an agent on a website, with none of the same signals: no headers to sign, no page to inspect, no badge to check. What a signed identity would even mean over a phone line is an open question we haven't answered.",
  },
  {
    name: "AI-generated phishing",
    body: "Generated messages remove the spelling mistakes and awkward phrasing people were taught to watch for. Every check in this product is deliberately built on what can be verified rather than on how text reads — that constraint is harder, and it is the only approach that would survive being pointed at a person's inbox.",
  },
  {
    name: "Agent-workflow reliability",
    body: "Declared intent asks what an agent came to do. A further question is whether it did what it was asked, and whether the person who deployed it would recognise the result. Nothing here measures that.",
  },
];
