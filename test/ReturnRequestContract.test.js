// test/ReturnRequestContract.test.js
const assert = require("assert");
const truffleAssert = require("truffle-assertions");

const ReturnRequestContract = artifacts.require("ReturnRequestContract");

const OrderContract = artifacts.require("OrderContract");

contract("ReturnRequestContract", (accounts) => {
  const [deployer, buyer, seller, other] = accounts;

  // Must match your Solidity enum order
  const RequestType = { Return: 0, Refund: 1 };
  const ReturnStatus = { None: 0, Requested: 1, Approved: 2, Rejected: 3 };

  let rr;
  let order;

  beforeEach(async () => {
    rr = await ReturnRequestContract.new({ from: deployer });
    order = await OrderContract.new({ from: deployer });
    await rr.setOrderContract(order.address, { from: deployer });
    await order.setReturnRequestContract(rr.address, { from: deployer });
  });
  describe("############### Integration: Refund Flow ######################", () => {
    it("should process refund and update order status/history and return ETH to buyer", async () => {
      // Buyer creates order and pays
      const productPrice = web3.utils.toWei("1", "ether");
      await order.createOrder(
        "Buyer Name",
        "123 Main St",
        "Product",
        productPrice,
        "img",
        "desc",
        { from: buyer, value: productPrice }
      );

      // Seller delivers, buyer confirms delivery (but will request refund)
      await order.updateOrderStatus(1, 3, "Delivered", { from: deployer });
      await order.confirmDelivery(1, true, { from: buyer });

      // Buyer requests refund
      await rr.requestReturnOrRefund(1, seller, RequestType.Refund, "Item defective", { from: buyer });

      // Record buyer balance before refund
      const buyerBalanceBefore = web3.utils.toBN(await web3.eth.getBalance(buyer));

      // Seller approves refund (triggers processRefund in OrderContract)
      const tx = await rr.approve(1, "Refund approved", { from: seller });

      // Check order status is Refunded
      const orderData = await order.getOrder(1);
      // OrderStatus enum: Pending=0, ..., Refunded=6
      assert.strictEqual(orderData[9].toNumber(), 6, "Order status should be Refunded");

      // Check tracking history includes Refunded
      const history = await order.getTrackingHistory(1);
      const lastEntry = history[history.length - 1];
      assert.strictEqual(lastEntry.status, "Refunded");

      // Check buyer received refund (allowing for gas usage)
      const buyerBalanceAfter = web3.utils.toBN(await web3.eth.getBalance(buyer));
      assert(buyerBalanceAfter.gte(buyerBalanceBefore), "Buyer should receive refund");

      // Check event emitted
      truffleAssert.eventEmitted(tx, "ReturnApproved");
    });
  });

  describe("############### Test requestReturnOrRefund ######################", () => {
    it("test_request_return_or_refund_success", async () => {
      assert.strictEqual((await rr.requestCount()).toNumber(), 0);

      const orderId = 1;
      const reason = "Wrong size";
      const type = RequestType.Return;

      const tx = await rr.requestReturnOrRefund(orderId, seller, type, reason, {
        from: buyer,
      });

      // event check (like how your python tests check returned results)
      truffleAssert.eventEmitted(tx, "ReturnRequested", (ev) => {
        return (
          ev.orderId.toNumber() === orderId &&
          ev.buyer === buyer &&
          ev.seller === seller &&
          ev.requestType.toNumber() === type &&
          ev.reason === reason
        );
      });

      assert.strictEqual((await rr.requestCount()).toNumber(), 1);

      const req = await rr.getRequest(orderId);
      assert.strictEqual(req.orderId.toNumber(), orderId);
      assert.strictEqual(req.buyer, buyer);
      assert.strictEqual(req.seller, seller);
      assert.strictEqual(req.requestType.toNumber(), type);
      assert.strictEqual(req.reason, reason);
      assert.strictEqual(req.status.toNumber(), ReturnStatus.Requested);
      assert.ok(req.requestedAt.toNumber() > 0);
      assert.strictEqual(req.sellerNote, "");
    });

    it("test_request_return_or_refund_invalid_orderId", async () => {
      await truffleAssert.reverts(
        rr.requestReturnOrRefund(0, seller, RequestType.Return, "Reason", { from: buyer }),
        "Invalid orderId"
      );
    });

    it("test_request_return_or_refund_invalid_seller", async () => {
      await truffleAssert.reverts(
        rr.requestReturnOrRefund(
          1,
          "0x0000000000000000000000000000000000000000",
          RequestType.Return,
          "Reason",
          { from: buyer }
        ),
        "Invalid seller"
      );
    });

    it("test_request_return_or_refund_missing_reason", async () => {
      await truffleAssert.reverts(
        rr.requestReturnOrRefund(1, seller, RequestType.Return, "", { from: buyer }),
        "Reason required"
      );
    });

    it("test_request_return_or_refund_existing_request", async () => {
      const orderId = 10;

      await rr.requestReturnOrRefund(orderId, seller, RequestType.Refund, "Not received", {
        from: buyer,
      });

      const original_count = (await rr.requestCount()).toNumber();

      await truffleAssert.reverts(
        rr.requestReturnOrRefund(orderId, seller, RequestType.Refund, "Duplicate", { from: buyer }),
        "Request already exists"
      );

      assert.strictEqual((await rr.requestCount()).toNumber(), original_count);
    });
  });

  describe("############### Test approve ######################", () => {
    it("test_approve_success", async () => {
      const orderId = 20;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Damaged item", {
        from: buyer,
      });

      const tx = await rr.approve(orderId, "Approved, return within 7 days", { from: seller });

      truffleAssert.eventEmitted(tx, "ReturnApproved", (ev) => {
        return (
          ev.orderId.toNumber() === orderId &&
          ev.seller === seller &&
          ev.note === "Approved, return within 7 days"
        );
      });

      const status = await rr.getStatus(orderId);
      assert.strictEqual(status.toNumber(), ReturnStatus.Approved);

      const req = await rr.getRequest(orderId);
      assert.strictEqual(req.status.toNumber(), ReturnStatus.Approved);
      assert.strictEqual(req.sellerNote, "Approved, return within 7 days");
    });

    it("test_approve_non_seller", async () => {
      const orderId = 21;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Wrong colour", {
        from: buyer,
      });

      await truffleAssert.reverts(rr.approve(orderId, "I approve", { from: other }), "Only seller can approve");
    });

    it("test_approve_no_pending_request", async () => {
      // no request created => should fail
      await truffleAssert.reverts(rr.approve(999, "No such request", { from: seller }), "No pending request");
    });

    it("test_approve_after_already_approved", async () => {
      const orderId = 22;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Issue", {
        from: buyer,
      });

      await rr.approve(orderId, "Ok", { from: seller });

      await truffleAssert.reverts(rr.approve(orderId, "Approve again", { from: seller }), "No pending request");
    });
  });

  describe("############### Test reject ######################", () => {
    it("test_reject_success", async () => {
      const orderId = 40;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Refund, "Changed mind", {
        from: buyer,
      });

      const tx = await rr.reject(orderId, "Reason not valid", { from: seller });

      truffleAssert.eventEmitted(tx, "ReturnRejected", (ev) => {
        return ev.orderId.toNumber() === orderId && ev.seller === seller && ev.note === "Reason not valid";
      });

      const status = await rr.getStatus(orderId);
      assert.strictEqual(status.toNumber(), ReturnStatus.Rejected);

      const req = await rr.getRequest(orderId);
      assert.strictEqual(req.status.toNumber(), ReturnStatus.Rejected);
      assert.strictEqual(req.sellerNote, "Reason not valid");
    });

    it("test_reject_non_seller", async () => {
      const orderId = 41;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Item defective", {
        from: buyer,
      });

      await truffleAssert.reverts(rr.reject(orderId, "No", { from: other }), "Only seller can reject");
    });

    it("test_reject_missing_note", async () => {
      const orderId = 42;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Item defective", {
        from: buyer,
      });

      await truffleAssert.reverts(rr.reject(orderId, "", { from: seller }), "Rejection note required");
    });

    it("test_reject_no_pending_request", async () => {
      await truffleAssert.reverts(rr.reject(999, "No such request", { from: seller }), "No pending request");
    });
  });

  describe("############### Test request listing getters ######################", () => {
    it("test_getAllRequestOrderIds_and_getRequestOrderIdAt", async () => {
      const ids0 = await rr.getAllRequestOrderIds();
      assert.strictEqual(ids0.length, 0);

      await rr.requestReturnOrRefund(100, seller, RequestType.Return, "Reason 1", { from: buyer });
      await rr.requestReturnOrRefund(200, seller, RequestType.Refund, "Reason 2", { from: buyer });

      const ids = await rr.getAllRequestOrderIds();
      assert.strictEqual(ids.length, 2);
      assert.strictEqual(ids[0].toNumber(), 100);
      assert.strictEqual(ids[1].toNumber(), 200);

      const first = await rr.getRequestOrderIdAt(0);
      const second = await rr.getRequestOrderIdAt(1);
      assert.strictEqual(first.toNumber(), 100);
      assert.strictEqual(second.toNumber(), 200);
    });

    it("test_getRequestOrderIdAt_out_of_range", async () => {
      await truffleAssert.reverts(rr.getRequestOrderIdAt(0), "Index out of range");

      await rr.requestReturnOrRefund(1, seller, RequestType.Return, "Reason", { from: buyer });

      await truffleAssert.reverts(rr.getRequestOrderIdAt(1), "Index out of range");
    });
  });
});