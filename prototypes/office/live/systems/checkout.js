// The checkout (docs/examples/checkout.scxml): a flat chart with a datamodel that ends in a final.
// The shopper puts products in the cart, checks out, gives an address and pays, at the hatch.
const card = { card: { number: "4242424242424242", expiry: "12/29" } };
export default {
  title: "Checkout",
  app: { id: "user", label: "the shopper", kind: "user" },
  preload: ["checkout.scxml"],
  inputs: {
    order: ["add", "remove", "checkout", "back", "ship", "pay"],
    variants: {
      add: [
        { label: "ADD NOTEBOOK", data: { sku: "notebook", quantity: 2 } },
        { label: "ADD MUG", data: { sku: "mug", quantity: 1, gift: true } },
      ],
      remove: [{ label: "REMOVE MUG", data: { sku: "mug" } }],
      ship: [{ label: "SHIP TO AMSTERDAM", data: { name: "Jana de Vries", street: "Prinsengracht 263", city: "Amsterdam", country: "NL" } }],
      pay: [
        { label: "PAY BY CARD", data: card },
        { label: "PAY BY VOUCHER", data: { voucher: "GIFT2026" } },
      ],
    },
  },
  async boot(ctx) {
    await ctx.spawn("checkout.scxml", { id: "checkout", label: "checkout" });
  },
  // the order is placed (a final state): a new shopper can start again
  controls(ctx) {
    return [{ id: "new-cart", at: "user", console: "door", title: "SHOP", label: "NEW SHOPPER", enabled: ctx.sessions().size === 0, press: () => ctx.spawn("checkout.scxml", { id: "checkout", label: "checkout" }) }];
  },
};
