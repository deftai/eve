import { defineSchedule } from "eve/schedules";

import sink from "../channels/sink.js";

export default defineSchedule({
  cron: "0 0 * * *",
  run({ receive, waitUntil, appAuth }) {
    waitUntil(
      receive(sink, {
        allowEmptyDelivery: true,
        auth: appAuth,
        message: "There is nothing to report. Finish without delivering a channel message.",
        target: { id: "quiet-check" },
      }),
    );
  },
});
