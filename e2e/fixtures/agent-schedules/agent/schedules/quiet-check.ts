import { defineSchedule } from "eve/schedules";

import sink from "../channels/sink.js";

export default defineSchedule({
  cron: "0 0 * * *",
  run({ receive, waitUntil, appAuth }) {
    waitUntil(
      receive(sink, {
        allowEmptyDelivery: true,
        auth: appAuth,
        message: "Call `skip_delivery` exactly once. Do not write any response text.",
        target: { id: "quiet-check" },
      }),
    );
  },
});
