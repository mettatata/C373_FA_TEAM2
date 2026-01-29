// test/ReturnRequestContract.test.js
const assert = require("assert");
const truffleAssert = require("truffle-assertions");

const ReturnRequestContract = artifacts.require("ReturnRequestContract");
const OrderContract = artifacts.require("OrderContract");

contract("ReturnRequestContract", (accounts) => {
  const [deployer, buyer, seller, other] = accounts;

  // Must match Solidity enum order
  const RequestType = { Return: 0, Refund: 1 };
  const ReturnStatus = { None: 0, Requested: 1, Approved: 2, Rejected: 3 };

  let rr;
  let order;

  const BN = (v) => web3.utils.toBN(v);
  const ZERO = "0x0000000000000000000000000000000000000000";

  // ---------- Helpers ----------
  async function createPaidOrderDeliveredConfirmed(orderIdExpected = 1, priceEth = "1") {
    const productPrice = web3.utils.toWei(priceEth, "ether");

    await order.createOrder(
      "Buyer Name",
      "123 Main St",
      "Product",
      productPrice,
      "img",
      "desc",
      { from: buyer, value: productPrice }
    );

    // If your OrderContract auto-increments order IDs, expected should be 1 in fresh deployment
    // Move order to Delivered then buyer confirms
    await order.updateOrderStatus(orderIdExpected, 3, "Delivered", { from: deployer });
    await order.confirmDelivery(orderIdExpected, true, { from: buyer });

    return productPrice;
  }

  async function requestRefund(orderId, reason = "Item defective") {
    const tx = await rr.requestReturnOrRefund(orderId, seller, RequestType.Refund, reason, { from: buyer });
    truffleAssert.eventEmitted(tx, "ReturnRequested");
    return tx;
  }

  async function requestReturn(orderId, reason = "Wrong size") {
    const tx = await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, reason, { from: buyer });
    truffleAssert.eventEmitted(tx, "ReturnRequested");
    return tx;
  }

  async function assertRequestFields(orderId, expected) {
    const r = await rr.getRequest(orderId);
    assert.strictEqual(r.orderId.toNumber(), expected.orderId);
    assert.strictEqual(r.buyer, expected.buyer);
    assert.strictEqual(r.seller, expected.seller);
    assert.strictEqual(r.requestType.toNumber(), expected.requestType);
    assert.strictEqual(r.reason, expected.reason);
    assert.strictEqual(r.status.toNumber(), expected.status);
    assert.ok(r.requestedAt.toNumber() > 0, "requestedAt should be > 0");
    assert.strictEqual(r.sellerNote, expected.sellerNote);
  }

  beforeEach(async () => {
    rr = await ReturnRequestContract.new({ from: deployplerFix(deployer) ? deployer : deployer });
    order = await OrderContract.new({ from: deployer });

    // Connect contracts both ways
    await rr.setOrderContract(order.address, { from: deployer });
    await order.setReturnRequestContract(rr.address, { from: deployer });
  });

  // Small guard in case someone pastes weird deployer variable (keeps file robust)
  function deployplerFix(addr) {
    return typeof addr === "string" && addr.length === 42;
  }

  // =========================================================
  // Integration: Refund Flow
  // =========================================================
  describe("############### Integration: Refund Flow ######################", () => {
    it("should process refund, update order status/history, update return request, and return ETH to buyer", async () => {
      const productPrice = await createPaidOrderDeliveredConfirmed(1, "1");

      // Buyer requests refund
      const reqTx = await rr.requestReturnOrRefund(1, seller, RequestType.Refund, "Item defective", { from: buyer });

      truffleAssert.eventEmitted(reqTx, "ReturnRequested", (ev) => {
        return (
          ev.orderId.toNumber() === 1 &&
          ev.buyer === buyer &&
          ev.seller === seller &&
          ev.requestType.toNumber() === RequestType.Refund &&
          ev.reason === "Item defective"
        );
      });

      // request stored
      const beforeReq = await rr.getRequest(1);
      assert.strictEqual(beforeReq.status.toNumber(), ReturnStatus.Requested);

      // Balance before approve
      const buyerBalBefore = BN(await web3.eth.getBalance(buyer));

      // Seller approves refund (should trigger OrderContract refund)
      const approveTx = await rr.approve(1, "Refund approved", { from: seller });

      truffleAssert.eventEmitted(approveTx, "ReturnApproved", (ev) => {
        return ev.orderId.toNumber() === 1 && ev.seller === seller && ev.note === "Refund approved";
      });

      // Return request updated
      const afterReq = await rr.getRequest(1);
      assert.strictEqual(afterReq.status.toNumber(), ReturnStatus.Approved);
      assert.strictEqual(afterReq.sellerNote, "Refund approved");

      // Order status is Refunded (you said enum Refunded=6)
      const orderData = await order.getOrder(1);
      assert.strictEqual(orderData[9].toNumber(), 6, "Order status should be Refunded");

      // Tracking history includes "Refunded"
      const history = await order.getTrackingHistory(1);
      assert.ok(history.length > 0);
      const last = history[history.length - 1];
      assert.strictEqual(last.status, "Refunded");

      // Balance after should increase by ~productPrice (tolerance)
      const buyerBalAfter = BN(await web3.eth.getBalance(buyer));
      const expectedMin = buyerBalBefore.add(BN(productPrice)).sub(BN(web3.utils.toWei("0.01", "ether")));
      assert(buyerBalAfter.gte(expectedMin), "Buyer should receive approx refund amount");
    });

    it("should NOT allow non-seller to approve refund (integration permission check)", async () => {
      await createPaidOrderDeliveredConfirmed(1, "1");
      await requestRefund(1, "Item defective");

      await truffleAssert.reverts(
        rr.approve(1, "Refund approved", { from: other }),
        "Only seller can approve"
      );
    });

    it("should allow seller to reject refund request and keep order not refunded", async () => {
      await createPaidOrderDeliveredConfirmed(1, "1");
      await requestRefund(1, "Not as described");

      const rejectTx = await rr.reject(1, "Refund rejected - valid item", { from: seller });
      truffleAssert.eventEmitted(rejectTx, "ReturnRejected", (ev) => {
        return ev.orderId.toNumber() === 1 && ev.seller === seller && ev.note === "Refund rejected - valid item";
      });

      const req = await rr.getRequest(1);
      assert.strictEqual(req.status.toNumber(), ReturnStatus.Rejected);
      assert.strictEqual(req.sellerNote, "Refund rejected - valid item");

      const orderData = await order.getOrder(1);
      assert.notStrictEqual(orderData[9].toNumber(), 6, "Order should not be Refunded after rejection");
    });

    it("should revert if seller tries to approve twice (integration state check)", async () => {
      await createPaidOrderDeliveredConfirmed(1, "1");
      await requestRefund(1, "Defective");

      await rr.approve(1, "Approved", { from: seller });

      await truffleAssert.reverts(
        rr.approve(1, "Approve again", { from: seller }),
        "No pending request"
      );
    });

    it("should revert if seller tries to reject after already approved", async () => {
      await createPaidOrderDeliveredConfirmed(1, "1");
      await requestRefund(1, "Defective");

      await rr.approve(1, "Approved", { from: seller });

      await truffleAssert.reverts(
        rr.reject(1, "Reject after approve", { from: seller }),
        "No pending request"
      );
    });

    it("should revert if seller tries to approve after already rejected", async () => {
      await createPaidOrderDeliveredConfirmed(1, "1");
      await requestRefund(1, "Defective");

      await rr.reject(1, "Rejected", { from: seller });

      await truffleAssert.reverts(
        rr.approve(1, "Approve after reject", { from: seller }),
        "No pending request"
      );
    });
  });

  // =========================================================
  // Unit Tests: requestReturnOrRefund
  // =========================================================
  describe("############### Test requestReturnOrRefund ######################", () => {
    it("test_request_return_success_fields_and_event", async () => {
      assert.strictEqual((await rr.requestCount()).toNumber(), 0);

      const orderId = 1;
      const reason = "Wrong size";
      const type = RequestType.Return;

      const tx = await rr.requestReturnOrRefund(orderId, seller, type, reason, { from: buyer });

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

      await assertRequestFields(orderId, {
        orderId,
        buyer,
        seller,
        requestType: type,
        reason,
        status: ReturnStatus.Requested,
        sellerNote: "",
      });

      const status = await rr.getStatus(orderId);
      assert.strictEqual(status.toNumber(), ReturnStatus.Requested);
    });

    it("test_request_refund_success_fields_and_event", async () => {
      const orderId = 2;
      const reason = "Item defective";
      const type = RequestType.Refund;

      const tx = await rr.requestReturnOrRefund(orderId, seller, type, reason, { from: buyer });
      truffleAssert.eventEmitted(tx, "ReturnRequested");

      await assertRequestFields(orderId, {
        orderId,
        buyer,
        seller,
        requestType: type,
        reason,
        status: ReturnStatus.Requested,
        sellerNote: "",
      });
    });

    it("test_request_invalid_orderId", async () => {
      await truffleAssert.reverts(
        rr.requestReturnOrRefund(0, seller, RequestType.Return, "Reason", { from: buyer }),
        "Invalid orderId"
      );
    });

    it("test_request_invalid_seller", async () => {
      await truffleAssert.reverts(
        rr.requestReturnOrRefund(1, ZERO, RequestType.Return, "Reason", { from: buyer }),
        "Invalid seller"
      );
    });

    it("test_request_missing_reason", async () => {
      await truffleAssert.reverts(
        rr.requestReturnOrRefund(1, seller, RequestType.Return, "", { from: buyer }),
        "Reason required"
      );
    });

    it("test_request_duplicate_orderId_rejected", async () => {
      const orderId = 10;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Refund, "Not received", { from: buyer });

      const countBefore = (await rr.requestCount()).toNumber();

      await truffleAssert.reverts(
        rr.requestReturnOrRefund(orderId, seller, RequestType.Refund, "Duplicate", { from: buyer }),
        "Request already exists"
      );

      const countAfter = (await rr.requestCount()).toNumber();
      assert.strictEqual(countAfter, countBefore);
    });

    it("test_requestCount_and_orderIds_increase_correctly", async () => {
      assert.strictEqual((await rr.requestCount()).toNumber(), 0);

      await requestReturn(100, "Reason 100");
      await requestRefund(200, "Reason 200");
      await requestReturn(300, "Reason 300");

      assert.strictEqual((await rr.requestCount()).toNumber(), 3);

      const ids = await rr.getAllRequestOrderIds();
      assert.strictEqual(ids.length, 3);
      assert.strictEqual(ids[0].toNumber(), 100);
      assert.strictEqual(ids[1].toNumber(), 200);
      assert.strictEqual(ids[2].toNumber(), 300);

      assert.strictEqual((await rr.getRequestOrderIdAt(0)).toNumber(), 100);
      assert.strictEqual((await rr.getRequestOrderIdAt(1)).toNumber(), 200);
      assert.strictEqual((await rr.getRequestOrderIdAt(2)).toNumber(), 300);
    });
  });

  // =========================================================
  // Unit Tests: approve
  // =========================================================
  describe("############### Test approve ######################", () => {
    it("test_approve_success_updates_status_and_note_and_event", async () => {
      const orderId = 20;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Damaged item", { from: buyer });

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

    it("test_approve_non_seller_reverts", async () => {
      const orderId = 21;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Wrong colour", { from: buyer });

      await truffleAssert.reverts(
        rr.approve(orderId, "I approve", { from: other }),
        "Only seller can approve"
      );
    });

    it("test_approve_no_pending_request_reverts", async () => {
      await truffleAssert.reverts(
        rr.approve(999, "No such request", { from: seller }),
        "No pending request"
      );
    });

    it("test_approve_after_already_approved_reverts", async () => {
      const orderId = 22;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Issue", { from: buyer });

      await rr.approve(orderId, "Ok", { from: seller });

      await truffleAssert.reverts(
        rr.approve(orderId, "Approve again", { from: seller }),
        "No pending request"
      );
    });

    it("test_approve_after_rejected_reverts", async () => {
      const orderId = 23;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Issue", { from: buyer });

      await rr.reject(orderId, "Rejected", { from: seller });

      await truffleAssert.reverts(
        rr.approve(orderId, "Approve after reject", { from: seller }),
        "No pending request"
      );
    });
  });

  // =========================================================
  // Unit Tests: reject
  // =========================================================
  describe("############### Test reject ######################", () => {
    it("test_reject_success_updates_status_and_note_and_event", async () => {
      const orderId = 40;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Refund, "Changed mind", { from: buyer });

      const tx = await rr.reject(orderId, "Reason not valid", { from: seller });

      truffleAssert.eventEmitted(tx, "ReturnRejected", (ev) => {
        return (
          ev.orderId.toNumber() === orderId &&
          ev.seller === seller &&
          ev.note === "Reason not valid"
        );
      });

      const status = await rr.getStatus(orderId);
      assert.strictEqual(status.toNumber(), ReturnStatus.Rejected);

      const req = await rr.getRequest(orderId);
      assert.strictEqual(req.status.toNumber(), ReturnStatus.Rejected);
      assert.strictEqual(req.sellerNote, "Reason not valid");
    });

    it("test_reject_non_seller_reverts", async () => {
      const orderId = 41;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Item defective", { from: buyer });

      await truffleAssert.reverts(
        rr.reject(orderId, "No", { from: other }),
        "Only seller can reject"
      );
    });

    it("test_reject_missing_note_reverts", async () => {
      const orderId = 42;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Item defective", { from: buyer });

      await truffleAssert.reverts(
        rr.reject(orderId, "", { from: seller }),
        "Rejection note required"
      );
    });

    it("test_reject_no_pending_request_reverts", async () => {
      await truffleAssert.reverts(
        rr.reject(999, "No such request", { from: seller }),
        "No pending request"
      );
    });

    it("test_reject_after_approved_reverts", async () => {
      const orderId = 43;
      await rr.requestReturnOrRefund(orderId, seller, RequestType.Return, "Issue", { from: buyer });

      await rr.approve(orderId, "Approved", { from: seller });

      await truffleAssert.reverts(
        rr.reject(orderId, "Reject after approve", { from: seller }),
        "No pending request"
      );
    });
  });

  // =========================================================
  // Unit Tests: request listing getters
  // =========================================================
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

    it("test_getStatus_for_nonexistent_request_is_None", async () => {
      const status = await rr.getStatus(777);
      assert.strictEqual(status.toNumber(), ReturnStatus.None);
    });
  });
});
