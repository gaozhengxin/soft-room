import {regionBypassed} from './region-bypass.ts';

// Official cluster 1 fleet snapshot: https://fleets.waku.org/data.json (2026-09-11).
// Amsterdam, US Central and Hong Kong; DNS and peer exchange remain enabled.
export const bootstrapPeers=[
  "/dns4/node-01.do-ams3.waku.sandbox.status.im/tcp/8000/wss/p2p/16Uiu2HAmNaeL4p3WEYzC9mgXBmBWSgWjPHRvatZTXnp8Jgv3iKsb",
  "/dns4/node-01.gc-us-central1-a.waku.sandbox.status.im/tcp/8000/wss/p2p/16Uiu2HAmRv1iQ3NoMMcjbtRmKxPuYBbF9nLYz2SDv9MTN8WhGuUU",
  "/dns4/node-01.ac-cn-hongkong-c.waku.sandbox.status.im/tcp/8000/wss/p2p/16Uiu2HAmQYiojgZ8APsh9wqbWNyCstVhnp9gbeNrxSEQnLJchC92",
  "/dns4/node-01.do-ams3.waku.test.status.im/tcp/8000/wss/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W",
  "/dns4/node-01.gc-us-central1-a.waku.test.status.im/tcp/8000/wss/p2p/16Uiu2HAmDCp8XJ9z1ev18zuv8NHekAsjNyezAvmMfFEJkiharitG",
  "/dns4/node-01.ac-cn-hongkong-c.waku.test.status.im/tcp/8000/wss/p2p/16Uiu2HAkzHaTP5JsUwfR9NR8Rj9HC24puS6ocaU8wze4QrXr9iXp"
];

export const privateWakuPeer='/dns4/waku.wakukusmartrecipe.uk/tcp/443/wss/p2p/16Uiu2HAm6hZ56yhEYhPNdA1vwSf5CTXtxEyHXuS86xfKYovTvNEv';
export function activeBootstrap(){
  const privateMode=regionBypassed();
  return {defaultBootstrap:!privateMode,peers:privateMode?[privateWakuPeer]:bootstrapPeers};
}
