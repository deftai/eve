import { defineChannel, POST } from "eve/channels";

export default defineChannel<undefined, void, { id: string }>({
  routes: [POST("/sink", async () => new Response("ok"))],
  receive(input, { send }) {
    return send(input.message, {
      auth: input.auth,
      continuationToken: input.target.id,
    });
  },
});
