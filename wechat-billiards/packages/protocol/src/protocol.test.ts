import { parseClientMessage, PROTOCOL_VERSION } from "./index";

const base = { protocolVersion: PROTOCOL_VERSION };

describe("protocol validation", () => {
  it("accepts a shot without accepting client outcomes", () => {
    const message = parseClientMessage({
      ...base,
      type: "shoot",
      matchId: "m1",
      shotId: "s1",
      input: { angle: 0, power: 0.5, spinX: 0, spinY: 0, elevation: 0 },
      snapshot: { scores: [999, 0] },
    }) as any;
    expect(message.type).toBe("shoot");
    expect(message.snapshot).toBeUndefined();
  });

  it("rejects incompatible versions and malformed rooms", () => {
    expect(() =>
      parseClientMessage({ type: "ping", protocolVersion: 99 }),
    ).toThrow();
    expect(() =>
      parseClientMessage({
        ...base,
        type: "joinRoom",
        roomCode: "abc",
        inviteToken: "x",
      }),
    ).toThrow();
  });

  it("rejects non-finite physics values and unknown commands", () => {
    expect(() =>
      parseClientMessage({
        ...base,
        type: "placeBall",
        matchId: "m",
        x: NaN,
        y: 0,
      }),
    ).toThrow();
    expect(() =>
      parseClientMessage({ ...base, type: "setScore", score: 99 }),
    ).toThrow();
  });
});
