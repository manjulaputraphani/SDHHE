import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import LoadingMark from "./LoadingMark";

describe("LoadingMark", () => {
  it("shows the round cup tile with its label", () => {
    const { container } = render(<LoadingMark />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(container.querySelector("svg")).not.toBeNull();
    // The tile, the caramel disc and the cream cup.
    expect(container.querySelector('circle[fill="#3E2A1F"]')).not.toBeNull();
    expect(container.querySelector('circle[fill="#C68A4E"]')).not.toBeNull();
    expect(container.querySelector('path[fill="#F3E6D2"]')).not.toBeNull();
  });

  it("can stand alone without a label", () => {
    render(<LoadingMark label={null} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
