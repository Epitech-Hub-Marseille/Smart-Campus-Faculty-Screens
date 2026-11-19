// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FallbackBoundary } from "./FallbackBoundary";

afterEach(cleanup);

function Broken(): never {
  throw new Error("cannot dress the alert");
}

describe("FallbackBoundary", () => {
  it("draws its children when they work", () => {
    render(
      <FallbackBoundary fallback={<p>default alert</p>}>
        <p>themed alert</p>
      </FallbackBoundary>,
    );
    expect(screen.getByText("themed alert")).toBeTruthy();
  });

  it("draws the default alert when the themed one throws, instead of a blank screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <FallbackBoundary fallback={<p>default alert</p>}>
        <Broken />
      </FallbackBoundary>,
    );
    expect(screen.getByText("default alert")).toBeTruthy();
  });
});
