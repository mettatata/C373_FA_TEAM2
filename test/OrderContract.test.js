const OrderContract = artifacts.require("OrderContract");

contract("OrderContract", (accounts) => {
    let contract;
    const owner = accounts[0];
    const buyer = accounts[1];
    const seller = accounts[2];
    const otherUser = accounts[3];

    // Test constants
    const productName = "Test Product";
    const productPrice = web3.utils.toWei("0.1", "ether");
    const productImage = "https://example.com/product.jpg";
    const productDesc = "A test product";
    const buyerName = "John Doe";
    const deliveryAddress = "123 Test Street, Test City, TC 12345";

    // Deploy contract before each test
    beforeEach(async () => {
        contract = await OrderContract.new();
    });

    // =====================================================
    // TEST 1: Contract Initialization
    // =====================================================
    describe("Contract Initialization", () => {
        it("should initialize with correct company name", async () => {
            const name = await contract.companyName();
            assert.equal(name, "LegitLah", "Company name should be LegitLah");
        });

        it("should start with order count of 0", async () => {
            const count = await contract.getOrderCount();
            assert.equal(count, 0, "Initial order count should be 0");
        });

        it("should set owner correctly", async () => {
            const contractOwner = await contract.owner();
            assert.equal(contractOwner, owner, "Owner should be the deployer");
        });
    });

    // =====================================================
    // TEST 2: Order Creation with Payment
    // =====================================================
    describe("createOrder() - Order Creation", () => {
        it("should create an order with payment", async () => {
            const tx = await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );

            // Check event was emitted
            assert.equal(tx.logs.length, 3, "Should emit 3 events");
            assert.equal(tx.logs[0].event, "OrderCreated", "Should emit OrderCreated event");
            assert.equal(tx.logs[1].event, "OrderPaid", "Should emit OrderPaid event");
            assert.equal(tx.logs[2].event, "PaymentHeld", "Should emit PaymentHeld event");

            // Check order count incremented
            const count = await contract.getOrderCount();
            assert.equal(count, 1, "Order count should be 1");
        });

        it("should fail if insufficient payment sent", async () => {
            const insufficientPayment = web3.utils.toWei("0.05", "ether");

            try {
                await contract.createOrder(
                    buyerName,
                    deliveryAddress,
                    productName,
                    productPrice,
                    productImage,
                    productDesc,
                    { from: buyer, value: insufficientPayment }
                );
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Insufficient payment"), "Error should mention insufficient payment");
            }
        });

        it("should create order with correct details", async () => {
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );

            const order = await contract.getOrder(1);

            assert.equal(order.orderId, 1, "Order ID should be 1");
            assert.equal(order.buyer, buyer, "Buyer address should match");
            assert.equal(order.seller, owner, "Seller should be owner");
            assert.equal(order.buyerName, buyerName, "Buyer name should match");
            assert.equal(order.deliveryAddress, deliveryAddress, "Delivery address should match");
            assert.equal(order.productName, productName, "Product name should match");
            assert.equal(order.totalAmount, productPrice, "Amount should match payment");
        });

        it("should initialize order in Pending status", async () => {
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );

            const order = await contract.getOrder(1);
            assert.equal(order.status, 0, "Status should be Pending (0)");
        });

        it("should hold payment in escrow", async () => {
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );

            const escrow = await contract.getEscrowStatus(1);
            assert.equal(escrow.isEscrowed, true, "Payment should be escrowed");
            assert.equal(escrow.isReleased, false, "Payment should not be released yet");
            assert.equal(escrow.amount, productPrice, "Escrow amount should match payment");
        });

        it("should assign buyer to userOrders mapping", async () => {
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );

            const userOrders = await contract.getUserOrders(buyer);
            assert.equal(userOrders.length, 1, "User should have 1 order");
            assert.equal(userOrders[0], 1, "Order ID should be 1");
        });
    });

    // =====================================================
    // TEST 3: Order Status Updates
    // =====================================================
    describe("updateOrderStatus() - Status Updates", () => {
        beforeEach(async () => {
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );
        });

        it("should update order status to Processing", async () => {
            await contract.updateOrderStatus(1, 1, "Order is being prepared");
            const order = await contract.getOrder(1);
            assert.equal(order.status, 1, "Status should be Processing (1)");
        });

        it("should update order status to Shipped", async () => {
            await contract.updateOrderStatus(1, 2, "Order has been shipped");
            const order = await contract.getOrder(1);
            assert.equal(order.status, 2, "Status should be Shipped (2)");
        });

        it("should update order status to Delivered", async () => {
            await contract.updateOrderStatus(1, 3, "Order has been delivered");
            const order = await contract.getOrder(1);
            assert.equal(order.status, 3, "Status should be Delivered (3)");
        });

        it("should fail with invalid order ID", async () => {
            try {
                await contract.updateOrderStatus(999, 1, "Should fail");
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Invalid order ID"), "Should throw Invalid order ID error");
            }
        });

        it("should add status update to tracking history", async () => {
            await contract.updateOrderStatus(1, 1, "Order is processing");
            const history = await contract.getTrackingHistory(1);
            
            // Should have 2 entries: initial + update
            assert.equal(history.length, 2, "Should have 2 tracking entries");
            assert.equal(history[1].status, "Processing", "Latest status should be Processing");
            assert.equal(history[1].description, "Order is processing", "Description should match");
        });
    });

    // =====================================================
    // TEST 4: Order Status with Tracking Number
    // =====================================================
    describe("updateOrderStatusWithTracking() - Status with Tracking", () => {
        beforeEach(async () => {
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );
        });

        it("should update status and store tracking number", async () => {
            const trackingNum = "TRACK123456789";
            
            await contract.updateOrderStatusWithTracking(
                1,
                2,
                "Order shipped with tracking",
                trackingNum
            );

            const tracking = await contract.getTrackingNumber(1);
            assert.equal(tracking, trackingNum, "Tracking number should be stored");
        });

        it("should emit TrackingNumberUpdated event", async () => {
            const trackingNum = "TRACK987654321";
            
            const tx = await contract.updateOrderStatusWithTracking(
                1,
                2,
                "Order shipped",
                trackingNum
            );

            assert(tx.logs.some(log => log.event === "TrackingNumberUpdated"), "Should emit TrackingNumberUpdated event");
        });
    });

    // =====================================================
    // TEST 5: Delivery Confirmation & Payment Release
    // =====================================================
    describe("confirmDelivery() - Delivery Confirmation & Payment Release", () => {
        beforeEach(async () => {
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );
            // Update status to Delivered
            await contract.updateOrderStatus(1, 3, "Order delivered");
        });

        it("should allow buyer to confirm delivery", async () => {
            const sellerBalanceBefore = await web3.eth.getBalance(owner);

            await contract.confirmDelivery(1, true, { from: buyer });

            const order = await contract.getOrder(1);
            assert.equal(order.status, 4, "Status should be Confirmed (4)");
            assert.equal(order.isPaid, true, "isPaid should be true");
        });

        it("should release payment to seller on confirmation", async () => {
            const sellerBalanceBefore = web3.utils.toBN(await web3.eth.getBalance(owner));

            await contract.confirmDelivery(1, true, { from: buyer });

            const sellerBalanceAfter = web3.utils.toBN(await web3.eth.getBalance(owner));
            const balanceDifference = sellerBalanceAfter.sub(sellerBalanceBefore);

            assert(balanceDifference.gt(0), "Seller balance should increase");
        });

        it("should set isReleased to true after confirmation", async () => {
            await contract.confirmDelivery(1, true, { from: buyer });

            const escrow = await contract.getEscrowStatus(1);
            assert.equal(escrow.isReleased, true, "Payment should be released");
        });

        it("should emit DeliveryConfirmed event", async () => {
            const tx = await contract.confirmDelivery(1, true, { from: buyer });

            assert(tx.logs.some(log => log.event === "DeliveryConfirmed"), "Should emit DeliveryConfirmed event");
        });

        it("should fail if non-buyer tries to confirm", async () => {
            try {
                await contract.confirmDelivery(1, true, { from: otherUser });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Only buyer can confirm delivery"), "Only buyer should be able to confirm");
            }
        });

        it("should fail if order not in Delivered status", async () => {
            // Create new order without updating to Delivered
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );

            try {
                await contract.confirmDelivery(2, true, { from: buyer });
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Order not yet delivered"), "Should require Delivered status");
            }
        });

        it("should add confirmation to tracking history", async () => {
            await contract.confirmDelivery(1, true, { from: buyer });

            const history = await contract.getTrackingHistory(1);
            const lastEntry = history[history.length - 1];

            assert.equal(lastEntry.status, "Confirmed", "Last status should be Confirmed");
            assert.equal(lastEntry.description, "Delivery confirmed by customer", "Description should match");
        });
    });

    // =====================================================
    // TEST 6: Tracking History
    // =====================================================
    describe("getTrackingHistory() - Order Timeline", () => {
        beforeEach(async () => {
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );
        });

        it("should record initial order creation", async () => {
            const history = await contract.getTrackingHistory(1);
            
            assert.equal(history.length, 1, "Should have 1 entry (creation)");
            assert.equal(history[0].status, "Order Created", "First entry should be Order Created");
        });

        it("should record all status updates", async () => {
            await contract.updateOrderStatus(1, 1, "Processing");
            await contract.updateOrderStatus(1, 2, "Shipped");
            await contract.updateOrderStatus(1, 3, "Delivered");

            const history = await contract.getTrackingHistory(1);
            
            assert.equal(history.length, 4, "Should have 4 entries");
            assert.equal(history[1].status, "Processing", "Second should be Processing");
            assert.equal(history[2].status, "Shipped", "Third should be Shipped");
            assert.equal(history[3].status, "Delivered", "Fourth should be Delivered");
        });

        it("should have timestamps for each entry", async () => {
            const history = await contract.getTrackingHistory(1);
            
            history.forEach(entry => {
                assert(entry.timestamp > 0, "Timestamp should be greater than 0");
            });
        });
    });

    // =====================================================
    // TEST 7: Tracking Number Management
    // =====================================================
    describe("Tracking Number Management", () => {
        beforeEach(async () => {
            await contract.createOrder(
                buyerName,
                deliveryAddress,
                productName,
                productPrice,
                productImage,
                productDesc,
                { from: buyer, value: productPrice }
            );
            await contract.updateOrderStatus(1, 2, "Order shipped");
        });

        it("should store tracking number via updateTrackingNumber", async () => {
            const trackingNum = "SHIP123456";
            
            await contract.updateTrackingNumber(1, trackingNum);
            const stored = await contract.getTrackingNumber(1);
            
            assert.equal(stored, trackingNum, "Tracking number should match");
        });

        it("should fail with empty tracking number", async () => {
            try {
                await contract.updateTrackingNumber(1, "");
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert(error.message.includes("Tracking number cannot be empty"), "Should reject empty tracking number");
            }
        });

        it("should return empty string if not shipped", async () => {
            // Create order in Pending status
            await contract.createOrder(
                "Jane", "456 Road", "Product", productPrice, productImage, productDesc,
                { from: otherUser, value: productPrice }
            );

            const tracking = await contract.getTrackingNumber(2);
            assert.equal(tracking, "", "Should return empty string for non-shipped order");
        });
    });

    // =====================================================
    // TEST 8: User Orders Retrieval
    // =====================================================
    describe("getUserOrders() - User Order History", () => {
        it("should return empty array for user with no orders", async () => {
            const orders = await contract.getUserOrders(otherUser);
            assert.equal(orders.length, 0, "New user should have no orders");
        });

        it("should return all orders for a user", async () => {
            // Create 3 orders from same buyer
            for (let i = 0; i < 3; i++) {
                await contract.createOrder(
                    buyerName, deliveryAddress, productName, productPrice,
                    productImage, productDesc,
                    { from: buyer, value: productPrice }
                );
            }

            const orders = await contract.getUserOrders(buyer);
            assert.equal(orders.length, 3, "User should have 3 orders");
            assert.equal(orders[0], 1, "First order ID should be 1");
            assert.equal(orders[1], 2, "Second order ID should be 2");
            assert.equal(orders[2], 3, "Third order ID should be 3");
        });
    });

    // =====================================================
    // TEST 9: Complete Order Lifecycle
    // =====================================================
    describe("Complete Order Lifecycle", () => {
        it("should follow complete order flow: Create -> Process -> Ship -> Deliver -> Confirm -> Pay", async () => {
            // Step 1: Create order with payment
            await contract.createOrder(
                buyerName, deliveryAddress, productName, productPrice,
                productImage, productDesc,
                { from: buyer, value: productPrice }
            );

            let order = await contract.getOrder(1);
            assert.equal(order.status, 0, "Should be Pending");
            // Payment is held in escrow when the order is created
            assert.equal(order.isPaid, true, "Escrow should already hold payment");

            // Step 2: Mark as Processing
            await contract.updateOrderStatus(1, 1, "Order processing");
            order = await contract.getOrder(1);
            assert.equal(order.status, 1, "Should be Processing");

            // Step 3: Mark as Shipped with tracking
            const trackingNum = "TRACK999";
            await contract.updateOrderStatusWithTracking(1, 2, "Order shipped", trackingNum);
            order = await contract.getOrder(1);
            assert.equal(order.status, 2, "Should be Shipped");

            // Step 4: Mark as Delivered
            await contract.updateOrderStatus(1, 3, "Order delivered");
            order = await contract.getOrder(1);
            assert.equal(order.status, 3, "Should be Delivered");

            // Step 5: Buyer confirms delivery (payment released)
            await contract.confirmDelivery(1, true, { from: buyer });
            order = await contract.getOrder(1);
            assert.equal(order.status, 4, "Should be Confirmed");
            assert.equal(order.isPaid, true, "Should be marked paid");
            assert.equal(order.isReleased, true, "Payment should be released");

            // Verify complete tracking history
            const history = await contract.getTrackingHistory(1);
            assert.equal(history.length, 5, "Should have 5 tracking entries");
        });
    });

    // =====================================================
    // TEST 10: Escrow Status Transparency
    // =====================================================
    describe("getEscrowStatus() - Payment Transparency", () => {
        beforeEach(async () => {
            await contract.createOrder(
                buyerName, deliveryAddress, productName, productPrice,
                productImage, productDesc,
                { from: buyer, value: productPrice }
            );
        });

        it("should show payment held after order creation", async () => {
            const escrow = await contract.getEscrowStatus(1);
            
            assert.equal(escrow.isEscrowed, true, "Payment should be escrowed");
            assert.equal(escrow.isReleased, false, "Payment should not be released");
            assert.equal(escrow.amount, productPrice, "Amount should match");
        });

        it("should show payment released after confirmation", async () => {
            await contract.updateOrderStatus(1, 3, "Delivered");
            await contract.confirmDelivery(1, true, { from: buyer });

            const escrow = await contract.getEscrowStatus(1);
            
            assert.equal(escrow.isReleased, true, "Payment should be released");
            assert.equal(escrow.amount, productPrice, "Amount should still match");
        });
    });
});
