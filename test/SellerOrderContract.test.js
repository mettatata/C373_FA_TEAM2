const SellerOrderContract = artifacts.require("SellerOrderContract");

contract("SellerOrderContract", (accounts) => {
    let contract;
    const contractOwner = accounts[0];
    const seller = accounts[1];
    const seller2 = accounts[2];
    const buyer = accounts[3];
    const buyer2 = accounts[4];
    const otherUser = accounts[5];

    // Test constants
    const sellerName = "Premium Seller";
    const sellerName2 = "Budget Seller";
    const buyerName = "John Customer";
    const buyerName2 = "Jane Shopper";
    const productName = "Electronic Widget";
    const productPrice = web3.utils.toWei("0.5", "ether");
    const trackingNumber = "SELLER123456789";

    // Deploy contract before each test
    beforeEach(async () => {
        contract = await SellerOrderContract.new();
    });

    // =====================================================
    // TEST 1: Contract Initialization
    // =====================================================
    describe("Contract Initialization", () => {
        it("should initialize with correct company name", async () => {
            const name = await contract.companyName();
            assert.equal(name, "LegitLah", "Company name should be LegitLah");
        });

        it("should start with seller order count of 0", async () => {
            const count = await contract.getSellerOrderCount();
            assert.equal(count, 0, "Initial order count should be 0");
        });

        it("should set contract owner correctly", async () => {
            const owner = await contract.contractOwner();
            assert.equal(owner, contractOwner, "Owner should be the deployer");
        });
    });

    // =====================================================
    // TEST 2: Seller Profile Creation
    // =====================================================
    describe("createSellerProfile() - Seller Profiles", () => {
        it("should create a seller profile", async () => {
            const tx = await contract.createSellerProfile(sellerName, { from: seller });

            assert.equal(tx.logs.length, 1, "Should emit 1 event");
            assert.equal(tx.logs[0].event, "SellerProfileCreated", "Should emit SellerProfileCreated event");
        });

        it("should store seller profile details correctly", async () => {
            await contract.createSellerProfile(sellerName, { from: seller });

            const profile = await contract.getSellerProfile(seller);
            
            assert.equal(profile.seller, seller, "Seller address should match");
            assert.equal(profile.sellerName, sellerName, "Seller name should match");
            assert.equal(profile.totalOrdersAccepted, 0, "Initial orders accepted should be 0");
            assert.equal(profile.totalOrdersShipped, 0, "Initial orders shipped should be 0");
            assert.equal(profile.totalEarnings, 0, "Initial earnings should be 0");
            assert.equal(profile.isActive, true, "Profile should be active");
        });

        it("should fail with empty seller name", async () => {
            try {
                await contract.createSellerProfile("", { from: seller });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Seller name cannot be empty"), "Should reject empty seller name");
            }
        });

        it("should fail if profile already exists", async () => {
            await contract.createSellerProfile(sellerName, { from: seller });

            try {
                await contract.createSellerProfile(sellerName2, { from: seller });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Profile already exists"), "Should prevent duplicate profiles");
            }
        });

        it("should allow multiple sellers to create profiles", async () => {
            await contract.createSellerProfile(sellerName, { from: seller });
            await contract.createSellerProfile(sellerName2, { from: seller2 });

            const profile1 = await contract.getSellerProfile(seller);
            const profile2 = await contract.getSellerProfile(seller2);

            assert.equal(profile1.sellerName, sellerName, "First seller name should match");
            assert.equal(profile2.sellerName, sellerName2, "Second seller name should match");
        });
    });

    // =====================================================
    // TEST 3: Seller Order Creation
    // =====================================================
    describe("createSellerOrder() - Order Creation", () => {
        beforeEach(async () => {
            await contract.createSellerProfile(sellerName, { from: seller });
        });

        it("should create a seller order", async () => {
            const tx = await contract.createSellerOrder(
                seller,
                buyer,
                buyerName,
                productName,
                productPrice
            );

            assert.equal(tx.logs.length, 1, "Should emit 1 event");
            assert.equal(tx.logs[0].event, "SellerOrderCreated", "Should emit SellerOrderCreated event");
        });

        it("should store seller order details correctly", async () => {
            await contract.createSellerOrder(
                seller,
                buyer,
                buyerName,
                productName,
                productPrice
            );

            const order = await contract.getSellerOrder(1);

            assert.equal(order.orderId, 1, "Order ID should be 1");
            assert.equal(order.seller, seller, "Seller address should match");
            assert.equal(order.buyer, buyer, "Buyer address should match");
            assert.equal(order.buyerName, buyerName, "Buyer name should match");
            assert.equal(order.productName, productName, "Product name should match");
            assert.equal(order.price, productPrice, "Price should match");
            assert.equal(order.status, 0, "Status should be Pending (0)");
        });

        it("should fail with invalid seller address", async () => {
            try {
                await contract.createSellerOrder(
                    "0x0000000000000000000000000000000000000000",
                    buyer,
                    buyerName,
                    productName,
                    productPrice
                );
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Invalid seller address"), "Should reject invalid seller");
            }
        });

        it("should fail with invalid buyer address", async () => {
            try {
                await contract.createSellerOrder(
                    seller,
                    "0x0000000000000000000000000000000000000000",
                    buyerName,
                    productName,
                    productPrice
                );
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Invalid buyer address"), "Should reject invalid buyer");
            }
        });

        it("should fail with zero price", async () => {
            try {
                await contract.createSellerOrder(
                    seller,
                    buyer,
                    buyerName,
                    productName,
                    0
                );
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Price must be greater than 0"), "Should reject zero price");
            }
        });

        it("should fail if seller profile is not active", async () => {
            try {
                await contract.createSellerOrder(
                    seller2,
                    buyer,
                    buyerName,
                    productName,
                    productPrice
                );
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Seller profile not active"), "Should require active seller profile");
            }
        });

        it("should increment order count", async () => {
            await contract.createSellerOrder(seller, buyer, buyerName, productName, productPrice);
            await contract.createSellerOrder(seller, buyer2, buyerName2, productName, productPrice);

            const count = await contract.getSellerOrderCount();
            assert.equal(count, 2, "Order count should be 2");
        });

        it("should add order to seller's order list", async () => {
            await contract.createSellerOrder(seller, buyer, buyerName, productName, productPrice);
            await contract.createSellerOrder(seller, buyer2, buyerName2, productName, productPrice);

            const sellerOrders = await contract.getSellerOrders(seller);
            assert.equal(sellerOrders.length, 2, "Seller should have 2 orders");
            assert.equal(sellerOrders[0], 1, "First order ID should be 1");
            assert.equal(sellerOrders[1], 2, "Second order ID should be 2");
        });
    });

    // =====================================================
    // TEST 4: Accept Order
    // =====================================================
    describe("acceptOrder() - Order Acceptance", () => {
        beforeEach(async () => {
            await contract.createSellerProfile(sellerName, { from: seller });
            await contract.createSellerOrder(seller, buyer, buyerName, productName, productPrice);
        });

        it("should allow seller to accept order", async () => {
            const tx = await contract.acceptOrder(1, { from: seller });

            assert.equal(tx.logs.length, 1, "Should emit 1 event");
            assert.equal(tx.logs[0].event, "OrderAccepted", "Should emit OrderAccepted event");
        });

        it("should update order status to Accepted", async () => {
            await contract.acceptOrder(1, { from: seller });

            const order = await contract.getSellerOrder(1);
            assert.equal(order.status, 1, "Status should be Accepted (1)");
            assert.equal(order.isAccepted, true, "isAccepted flag should be true");
        });

        it("should increment seller's total orders accepted", async () => {
            await contract.acceptOrder(1, { from: seller });

            const profile = await contract.getSellerProfile(seller);
            assert.equal(profile.totalOrdersAccepted, 1, "Total orders accepted should be 1");
        });

        it("should fail if non-seller tries to accept", async () => {
            try {
                await contract.acceptOrder(1, { from: otherUser });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Only seller can accept the order"), "Only seller can accept");
            }
        });

        it("should fail if order already accepted", async () => {
            await contract.acceptOrder(1, { from: seller });

            try {
                await contract.acceptOrder(1, { from: seller });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Order already accepted"), "Should prevent double acceptance");
            }
        });

        it("should fail with invalid order ID", async () => {
            try {
                await contract.acceptOrder(999, { from: seller });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Invalid order ID"), "Should reject invalid order ID");
            }
        });
    });

    // =====================================================
    // TEST 5: Ship Order
    // =====================================================
    describe("shipOrder() - Order Shipping", () => {
        beforeEach(async () => {
            await contract.createSellerProfile(sellerName, { from: seller });
            await contract.createSellerOrder(seller, buyer, buyerName, productName, productPrice);
            await contract.acceptOrder(1, { from: seller });
        });

        it("should allow seller to ship order", async () => {
            const tx = await contract.shipOrder(1, trackingNumber, { from: seller });

            assert.equal(tx.logs.length, 1, "Should emit 1 event");
            assert.equal(tx.logs[0].event, "OrderShipped", "Should emit OrderShipped event");
        });

        it("should update order status to Shipped", async () => {
            await contract.shipOrder(1, trackingNumber, { from: seller });

            const order = await contract.getSellerOrder(1);
            assert.equal(order.status, 2, "Status should be Shipped (2)");
            assert.equal(order.isShipped, true, "isShipped flag should be true");
        });

        it("should store tracking number", async () => {
            await contract.shipOrder(1, trackingNumber, { from: seller });

            const order = await contract.getSellerOrder(1);
            assert.equal(order.trackingNumber, trackingNumber, "Tracking number should be stored");
        });

        it("should increment seller's total orders shipped", async () => {
            await contract.shipOrder(1, trackingNumber, { from: seller });

            const profile = await contract.getSellerProfile(seller);
            assert.equal(profile.totalOrdersShipped, 1, "Total orders shipped should be 1");
        });

        it("should fail if non-seller tries to ship", async () => {
            try {
                await contract.shipOrder(1, trackingNumber, { from: otherUser });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Only seller can ship the order"), "Only seller can ship");
            }
        });

        it("should fail with empty tracking number", async () => {
            try {
                await contract.shipOrder(1, "", { from: seller });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Tracking number cannot be empty"), "Should reject empty tracking");
            }
        });

        it("should fail if order not accepted", async () => {
            // Create new order without accepting
            await contract.createSellerOrder(seller, buyer2, buyerName2, productName, productPrice);

            try {
                await contract.shipOrder(2, trackingNumber, { from: seller });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Order must be accepted first"), "Should require acceptance");
            }
        });

        it("should fail if order already shipped", async () => {
            await contract.shipOrder(1, trackingNumber, { from: seller });

            try {
                await contract.shipOrder(1, "ANOTHER123", { from: seller });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Order already shipped"), "Should prevent double shipping");
            }
        });
    });

    // =====================================================
    // TEST 6: Release Payment
    // =====================================================
    describe("releasePayment() - Payment Release", () => {
        beforeEach(async () => {
            await contract.createSellerProfile(sellerName, { from: seller });
            await contract.createSellerOrder(seller, buyer, buyerName, productName, productPrice);
            await contract.acceptOrder(1, { from: seller });
            await contract.shipOrder(1, trackingNumber, { from: seller });
        });

        it("should allow buyer to release payment", async () => {
            const tx = await contract.releasePayment(1, { 
                from: buyer, 
                value: productPrice 
            });

            assert.equal(tx.logs.length, 1, "Should emit 1 event");
            assert.equal(tx.logs[0].event, "PaymentReleased", "Should emit PaymentReleased event");
        });

        it("should update order status to Paid", async () => {
            await contract.releasePayment(1, { from: buyer, value: productPrice });

            const order = await contract.getSellerOrder(1);
            assert.equal(order.status, 4, "Status should be Paid (4)");
            assert.equal(order.isPaid, true, "isPaid flag should be true");
        });

        it("should transfer payment to seller's balance", async () => {
            const balanceBefore = await contract.getSellerBalance(seller);
            assert.equal(balanceBefore, 0, "Initial balance should be 0");

            await contract.releasePayment(1, { from: buyer, value: productPrice });

            const balanceAfter = await contract.getSellerBalance(seller);
            assert.equal(balanceAfter, productPrice, "Seller balance should equal payment amount");
        });

        it("should update seller profile earnings", async () => {
            await contract.releasePayment(1, { from: buyer, value: productPrice });

            const profile = await contract.getSellerProfile(seller);
            assert.equal(profile.totalEarnings, productPrice, "Total earnings should equal payment");
        });

        it("should create payment record", async () => {
            await contract.releasePayment(1, { from: buyer, value: productPrice });

            const paymentRecord = await contract.paymentRecords(1);
            assert.equal(paymentRecord.orderId, 1, "Payment record order ID should be 1");
            assert.equal(paymentRecord.amount, productPrice, "Payment record amount should match");
            assert.equal(paymentRecord.isPaid, true, "Payment record should mark as paid");
        });

        it("should fail if non-buyer tries to release payment", async () => {
            try {
                await contract.releasePayment(1, { from: otherUser, value: productPrice });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Only buyer can release payment"), "Only buyer can release");
            }
        });

        it("should fail if insufficient payment sent", async () => {
            const insufficientPayment = web3.utils.toWei("0.1", "ether");

            try {
                await contract.releasePayment(1, { from: buyer, value: insufficientPayment });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Insufficient payment amount"), "Should reject insufficient payment");
            }
        });

        it("should fail if order not shipped", async () => {
            // Create new order without shipping
            await contract.createSellerOrder(seller, buyer2, buyerName2, productName, productPrice);
            await contract.acceptOrder(2, { from: seller });

            try {
                await contract.releasePayment(2, { from: buyer2, value: productPrice });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Order must be shipped first"), "Should require shipping");
            }
        });

        it("should fail if payment already released", async () => {
            await contract.releasePayment(1, { from: buyer, value: productPrice });

            try {
                await contract.releasePayment(1, { from: buyer, value: productPrice });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Payment already released"), "Should prevent double payment");
            }
        });
    });

    // =====================================================
    // TEST 7: Withdraw Balance
    // =====================================================
    describe("withdrawBalance() - Seller Withdrawals", () => {
        beforeEach(async () => {
            await contract.createSellerProfile(sellerName, { from: seller });
            await contract.createSellerOrder(seller, buyer, buyerName, productName, productPrice);
            await contract.acceptOrder(1, { from: seller });
            await contract.shipOrder(1, trackingNumber, { from: seller });
            await contract.releasePayment(1, { from: buyer, value: productPrice });
        });

        it("should allow seller to withdraw balance", async () => {
            const balanceBefore = web3.utils.toBN(await web3.eth.getBalance(seller));
            
            await contract.withdrawBalance({ from: seller });

            const balanceAfter = web3.utils.toBN(await web3.eth.getBalance(seller));
            assert(balanceAfter.gt(balanceBefore), "Balance should increase by withdrawn amount");
        });

        it("should clear seller's contract balance after withdrawal", async () => {
            const balanceBefore = await contract.getSellerBalance(seller);
            assert.equal(balanceBefore, productPrice, "Balance should equal payment");

            await contract.withdrawBalance({ from: seller });

            const balanceAfter = await contract.getSellerBalance(seller);
            assert.equal(balanceAfter, 0, "Balance should be 0 after withdrawal");
        });

        it("should fail if no balance to withdraw", async () => {
            try {
                await contract.withdrawBalance({ from: otherUser });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("No balance to withdraw"), "Should reject withdrawal with no balance");
            }
        });
    });

    // =====================================================
    // TEST 8: Cancel Order
    // =====================================================
    describe("cancelOrder() - Order Cancellation", () => {
        beforeEach(async () => {
            await contract.createSellerProfile(sellerName, { from: seller });
            await contract.createSellerOrder(seller, buyer, buyerName, productName, productPrice);
            await contract.acceptOrder(1, { from: seller });
        });

        it("should allow seller to cancel unshipped order", async () => {
            const tx = await contract.cancelOrder(1, { from: seller });

            assert.equal(tx.logs.length, 1, "Should emit 1 event");
            assert.equal(tx.logs[0].event, "OrderCancelled", "Should emit OrderCancelled event");
        });

        it("should update order status to Cancelled", async () => {
            await contract.cancelOrder(1, { from: seller });

            const order = await contract.getSellerOrder(1);
            assert.equal(order.status, 5, "Status should be Cancelled (5)");
        });

        it("should fail if non-seller tries to cancel", async () => {
            try {
                await contract.cancelOrder(1, { from: otherUser });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Only seller can cancel the order"), "Only seller can cancel");
            }
        });

        it("should fail if order already shipped", async () => {
            await contract.shipOrder(1, trackingNumber, { from: seller });

            try {
                await contract.cancelOrder(1, { from: seller });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Cannot cancel a shipped order"), "Cannot cancel shipped orders");
            }
        });
    });

    // =====================================================
    // TEST 9: Get Tracking Number
    // =====================================================
    describe("getTrackingNumber() - Tracking Visibility", () => {
        beforeEach(async () => {
            await contract.createSellerProfile(sellerName, { from: seller });
            await contract.createSellerOrder(seller, buyer, buyerName, productName, productPrice);
            await contract.acceptOrder(1, { from: seller });
            await contract.shipOrder(1, trackingNumber, { from: seller });
        });

        it("should allow seller to view tracking number", async () => {
            const tracking = await contract.getTrackingNumber(1, { from: seller });
            assert.equal(tracking, trackingNumber, "Seller should see tracking number");
        });

        it("should allow buyer to view tracking number", async () => {
            const tracking = await contract.getTrackingNumber(1, { from: buyer });
            assert.equal(tracking, trackingNumber, "Buyer should see tracking number");
        });

        it("should fail if unauthorized user tries to view", async () => {
            try {
                await contract.getTrackingNumber(1, { from: otherUser });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Only seller or buyer can view"), "Only seller/buyer can view");
            }
        });

        it("should fail if order not shipped", async () => {
            // Create order without shipping
            await contract.createSellerOrder(seller, buyer2, buyerName2, productName, productPrice);
            await contract.acceptOrder(2, { from: seller });

            try {
                await contract.getTrackingNumber(2, { from: buyer2 });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Tracking number not available"), "Tracking unavailable until shipped");
            }
        });
    });

    // =====================================================
    // TEST 10: Complete Order Lifecycle
    // =====================================================
    describe("Complete Order Lifecycle", () => {
        it("should follow complete seller order flow", async () => {
            // Step 1: Create seller profile
            await contract.createSellerProfile(sellerName, { from: seller });

            // Step 2: Create order
            await contract.createSellerOrder(seller, buyer, buyerName, productName, productPrice);
            let order = await contract.getSellerOrder(1);
            assert.equal(order.status, 0, "Should start as Pending");

            // Step 3: Accept order
            await contract.acceptOrder(1, { from: seller });
            order = await contract.getSellerOrder(1);
            assert.equal(order.status, 1, "Should be Accepted");

            // Step 4: Ship order
            await contract.shipOrder(1, trackingNumber, { from: seller });
            order = await contract.getSellerOrder(1);
            assert.equal(order.status, 2, "Should be Shipped");

            // Step 5: Release payment
            await contract.releasePayment(1, { from: buyer, value: productPrice });
            order = await contract.getSellerOrder(1);
            assert.equal(order.status, 4, "Should be Paid");
            assert.equal(order.isPaid, true, "Should be marked paid");

            // Step 6: Verify seller profile updates
            const profile = await contract.getSellerProfile(seller);
            assert.equal(profile.totalOrdersAccepted, 1, "Should have 1 accepted order");
            assert.equal(profile.totalOrdersShipped, 1, "Should have 1 shipped order");
            assert.equal(profile.totalEarnings, productPrice, "Should have earnings");

            // Step 7: Seller withdraws balance
            const sellerBalanceBefore = await contract.getSellerBalance(seller);
            assert.equal(sellerBalanceBefore, productPrice, "Should have balance");

            await contract.withdrawBalance({ from: seller });
            const sellerBalanceAfter = await contract.getSellerBalance(seller);
            assert.equal(sellerBalanceAfter, 0, "Balance should be cleared");
        });
    });

    // =====================================================
    // TEST 11: Multiple Sellers and Buyers
    // =====================================================
    describe("Multiple Sellers and Buyers", () => {
        it("should handle multiple sellers with independent orders", async () => {
            // Create two seller profiles
            await contract.createSellerProfile(sellerName, { from: seller });
            await contract.createSellerProfile(sellerName2, { from: seller2 });

            // Create orders from both sellers
            await contract.createSellerOrder(seller, buyer, buyerName, productPrice, productPrice);
            await contract.createSellerOrder(seller2, buyer2, buyerName2, productPrice, productPrice);

            // Each seller should have their own orders
            const seller1Orders = await contract.getSellerOrders(seller);
            const seller2Orders = await contract.getSellerOrders(seller2);

            assert.equal(seller1Orders.length, 1, "Seller 1 should have 1 order");
            assert.equal(seller2Orders.length, 1, "Seller 2 should have 1 order");
        });

        it("should maintain independent balances for multiple sellers", async () => {
            const paymentAmount1 = web3.utils.toWei("0.5", "ether");
            const paymentAmount2 = web3.utils.toWei("0.3", "ether");

            // Setup seller 1
            await contract.createSellerProfile(sellerName, { from: seller });
            await contract.createSellerOrder(seller, buyer, buyerName, paymentAmount1, paymentAmount1);
            await contract.acceptOrder(1, { from: seller });
            await contract.shipOrder(1, trackingNumber, { from: seller });
            await contract.releasePayment(1, { from: buyer, value: paymentAmount1 });

            // Setup seller 2
            await contract.createSellerProfile(sellerName2, { from: seller2 });
            await contract.createSellerOrder(seller2, buyer2, buyerName2, paymentAmount2, paymentAmount2);
            await contract.acceptOrder(2, { from: seller2 });
            await contract.shipOrder(2, "TRACK2", { from: seller2 });
            await contract.releasePayment(2, { from: buyer2, value: paymentAmount2 });

            // Verify independent balances
            const balance1 = await contract.getSellerBalance(seller);
            const balance2 = await contract.getSellerBalance(seller2);

            assert.equal(balance1, paymentAmount1, "Seller 1 should have correct balance");
            assert.equal(balance2, paymentAmount2, "Seller 2 should have correct balance");
        });
    });
});
