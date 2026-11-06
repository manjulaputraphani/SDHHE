/**
 * The product tour steps (Phase 15, component 6).
 *
 * The steps live in a config file, so a tour can be added per release or per
 * feature. `target` is a CSS selector of the element the tour points at.
 */
export type TourStep = {
  title: string;
  text: string;
  target?: string;
};

export type Tour = {
  id: string;
  name: string;
  steps: TourStep[];
};

export const TOURS: Tour[] = [
  {
    id: "team-chat",
    name: "The Team Chat",
    steps: [
      {
        title: "Talk to the team",
        text: "Open Team Chat to write to everybody — or start a private chat with one person.",
        target: '[data-tour="team-chat"]',
      },
      {
        title: "Receipts need an approval",
        text: "Attach a bill photo in the chat: it appears in the approvals panel and the owner can approve it.",
        target: '[data-tour="team-chat"]',
      },
      {
        title: "You will know who read it",
        text: "Your own messages carry the ticks: one for sent, two for delivered and three for read.",
        target: '[data-tour="team-chat"]',
      },
    ],
  },
  {
    id: "dashboard",
    name: "The dashboard",
    steps: [
      {
        title: "Everything at a glance",
        text: "The dashboard shows today's sales, the month's profit and the low-stock items.",
        target: '[data-tour="dashboard"]',
      },
    ],
  },
];
