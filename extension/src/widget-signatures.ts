/**
 * Known chat and AI agent widgets, for the AI Check tab's widget detection.
 *
 * This is the only place providers are defined. To add one, append an entry:
 * no other code changes are needed. Keep entries factual and specific. A match
 * is shown to users as a fact, so prefer hosts and element IDs that only the
 * widget itself uses, never generic ones like "#chat" or a vendor's general
 * analytics host.
 *
 * - `kind: "ai_agent"`: the product is an AI chatbot/agent. Shown as
 *   "AI agent widget detected".
 * - `kind: "chat_with_ai"`: a chat/help-desk widget whose vendor offers AI
 *   agents. The page can't show whether AI is switched on, so it's shown as
 *   "Chat widget detected" with that caveat.
 * - `hosts`: script, iframe or network hosts the widget loads from. A host
 *   matches itself and any subdomain.
 * - `selectors`: CSS selectors for elements the widget adds to the page,
 *   including its own embed <script> (e.g. `script[src*="vendor.com/embed"]`)
 *   when the vendor's host also serves unrelated files.
 *
 * A host match alone is reported as a detection, so only list a host if
 * loading anything from it means the widget is installed.
 *
 * Checked against live pages on 2026-09-15: Intercom, Tidio, Chatbase,
 * Botpress, Tawk.to, LiveChat and Zendesk matched on their vendors' own sites.
 * Crisp, Drift, HubSpot chat, Freshchat, Voiceflow and Ada are taken from
 * their embed documentation. Their own marketing sites didn't run the
 * standard widget, so those entries weren't confirmed live.
 */

export type WidgetKind = "ai_agent" | "chat_with_ai";

export type WidgetSignature = {
  id: string;
  name: string;
  kind: WidgetKind;
  hosts: string[];
  selectors: string[];
};

export const WIDGET_SIGNATURES: WidgetSignature[] = [
  // AI-native chatbots and agents
  {
    id: "chatbase",
    name: "Chatbase",
    kind: "ai_agent",
    // www.chatbase.co also serves its marketing site and images, so match the embed itself.
    hosts: [],
    selectors: [
      "#chatbase-bubble-button",
      "#chatbase-bubble-window",
      'script[src*="chatbase.co/embed"]',
      'iframe[src*="chatbase.co/chatbot-iframe"]',
    ],
  },
  {
    id: "voiceflow",
    name: "Voiceflow",
    kind: "ai_agent",
    hosts: ["cdn.voiceflow.com", "general-runtime.voiceflow.com"],
    selectors: ["#voiceflow-chat"],
  },
  {
    id: "botpress",
    name: "Botpress",
    kind: "ai_agent",
    hosts: ["cdn.botpress.cloud", "webchat.botpress.cloud"],
    selectors: ["#bp-web-widget-container"],
  },
  {
    id: "ada",
    name: "Ada",
    kind: "ai_agent",
    hosts: ["static.ada.support"],
    selectors: ["#ada-button-frame", "#ada-chat-frame"],
  },

  // Chat and help-desk widgets whose vendors offer AI agents
  {
    id: "intercom",
    name: "Intercom",
    kind: "chat_with_ai",
    hosts: ["widget.intercom.io", "js.intercomcdn.com"],
    selectors: ["#intercom-container", ".intercom-lightweight-app", "#intercom-frame"],
  },
  {
    id: "drift",
    name: "Drift",
    kind: "chat_with_ai",
    hosts: ["js.driftt.com"],
    selectors: ["#drift-widget", "#drift-frame-controller", "#drift-frame-chat"],
  },
  {
    id: "zendesk",
    name: "Zendesk",
    kind: "chat_with_ai",
    // static.zdassets.com also serves Zendesk analytics and help-center assets (seen on zendesk.com
    // with no chat widget), so only the widget snippet and its config host count.
    hosts: ["ekr.zdassets.com"],
    selectors: ["script#ze-snippet", 'script[src*="static.zdassets.com/ekr/snippet.js"]'],
  },
  {
    id: "crisp",
    name: "Crisp",
    kind: "chat_with_ai",
    hosts: ["client.crisp.chat"],
    selectors: [".crisp-client", "#crisp-chatbox"],
  },
  {
    id: "tidio",
    name: "Tidio",
    kind: "chat_with_ai",
    hosts: ["code.tidio.co"],
    selectors: ["#tidio-chat", "#tidio-chat-iframe"],
  },
  {
    id: "hubspot-chat",
    name: "HubSpot chat",
    kind: "chat_with_ai",
    // HubSpot's tracking code can load js.usemessages.com with no chat shown (seen on botpress.com),
    // so only the chat container counts.
    hosts: [],
    selectors: ["#hubspot-messages-iframe-container"],
  },
  {
    id: "livechat",
    name: "LiveChat",
    kind: "chat_with_ai",
    hosts: ["cdn.livechatinc.com"],
    selectors: ["#chat-widget-container"],
  },
  {
    id: "freshchat",
    name: "Freshchat",
    kind: "chat_with_ai",
    hosts: ["wchat.freshchat.com"],
    selectors: ["#fc_frame"],
  },
  {
    id: "tawk",
    name: "Tawk.to",
    kind: "chat_with_ai",
    hosts: ["embed.tawk.to"],
    selectors: [],
  },
];
