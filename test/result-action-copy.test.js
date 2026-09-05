import test from "node:test";
import assert from "node:assert/strict";
import { resultActionCopy } from "../src/result-actions.js";

test("resolves null primary actions to a phone action when the restaurant has a phone", () => {
  assert.deepEqual(resultActionCopy(null, { phone: "+81-3-1234-5678", name: "Demo" }), {
    type: "phone",
    href: "tel:+81-3-1234-5678",
    label: "",
    headingKey: "result.actionPhoneHeading",
    buttonKey: "result.actionPhone"
  });
});

test("resolves null primary actions to a map action when no phone is available", () => {
  const copy = resultActionCopy(null, { name: "Demo Restaurant", address: "Tokyo" });
  assert.equal(copy.type, "map");
  assert.match(copy.href, /^https:\/\/www\.google\.com\/maps\/search/);
  assert.equal(copy.headingKey, "result.actionMapHeading");
  assert.equal(copy.buttonKey, "result.actionMap");
});

test("keeps a booking action as the consistent primary action", () => {
  assert.deepEqual(resultActionCopy({ type: "open_booking_source", label: "Book now", url: "https://booking.example/reserve" }, { phone: "03-0000-0000" }), {
    type: "open_booking_source",
    href: "https://booking.example/reserve",
    label: "Book now",
    headingKey: "result.actionBookingHeading",
    buttonKey: "result.actionBooking"
  });
});
