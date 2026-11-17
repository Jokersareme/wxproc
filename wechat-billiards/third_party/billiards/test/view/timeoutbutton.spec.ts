import { expect } from "chai";
import { TimeoutButton } from "../../src/view/timeoutbutton";

describe("TimeoutButton", () => {
  let button: HTMLButtonElement;
  let timeoutButton: TimeoutButton;
  let completed = false;

  beforeEach(() => {
    button = document.createElement("button");
    completed = false;
    timeoutButton = new TimeoutButton(button, {
      duration: 100,
      onComplete: () => {
        completed = true;
      },
    });
    // Mock requestAnimationFrame
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      return setTimeout(
        () => callback(performance.now()),
        16,
      ) as unknown as number;
    };
    globalThis.cancelAnimationFrame = (id: number) => {
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    };
  });

  it("should start the timer and keep the button enabled", (done) => {
    timeoutButton.startTimer();
    expect(button.disabled).to.be.false;
    expect(button.style.getPropertyValue("--timer-color")).to.equal("#10b981");

    setTimeout(() => {
      try {
        expect(completed).to.be.true;
        done();
      } catch (e) {
        done(e);
      }
    }, 150);
  });

  it("should transition to critical color", async () => {
    timeoutButton = new TimeoutButton(button, {
      duration: 100,
      criticalMs: 50,
    });
    timeoutButton.startTimer();

    for (let waited = 0; waited < 1000; waited += 10) {
      if (button.style.getPropertyValue("--timer-color") === "#ef4444") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(button.style.getPropertyValue("--timer-color")).to.equal("#ef4444");
  });
});
