import type { TabError } from "@shared/types";

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Human words for the Chromium network errors people actually meet. */
export function describeError(error: TabError): { title: string; text: string } {
  const host = hostOf(error.url);
  if (error.kind === "https") {
    return {
      title: `${host} doesn't offer a secure connection`,
      text: "Moon Browser tried HTTPS first, but this site has no working secure version. If you continue, anyone on your network could read or change what you send and receive.",
    };
  }
  if (error.kind === "blocked") {
    return {
      title: "Moon Shield blocked this page",
      text: `${host} is on a filter list of sites that spread malware, scams or trackers. Nothing was loaded from it.`,
    };
  }
  const code = error.code;
  if (code <= -200 && code > -300) {
    return {
      title: "This connection is not private",
      text: `The security certificate of ${host} is not valid, so Moon Browser stopped before anything was sent. Someone might be trying to intercept your data.`,
    };
  }
  switch (code) {
    case -105:
    case -137:
      return {
        title: "This site can't be found",
        text: `The server address of ${host} could not be found. Check the address for typos.`,
      };
    case -106:
      return {
        title: "You're offline",
        text: "Check your network cables, modem and router, or reconnect to Wi-Fi.",
      };
    case -102:
      return { title: "This site can't be reached", text: `${host} refused to connect.` };
    case -118:
    case -7:
      return {
        title: "This site took too long to respond",
        text: `${host} didn't answer in time. It may be busy or down.`,
      };
    case -310:
      return {
        title: "This page isn't working",
        text: `${host} redirected you too many times. Clearing its cookies may help.`,
      };
    case -324:
    case -100:
    case -101:
      return {
        title: "This page isn't working",
        text: `${host} closed the connection without sending anything.`,
      };
    case -109:
      return {
        title: "This site can't be reached",
        text: `${host} is unreachable from your network.`,
      };
    case -21:
      return {
        title: "Your network changed",
        text: "The connection was interrupted by a network change.",
      };
    case -20:
      return { title: "This page was blocked", text: "Moon Shield blocked this page." };
    default:
      return {
        title: "This page couldn't be loaded",
        text: `Something went wrong while loading ${host}.`,
      };
  }
}
