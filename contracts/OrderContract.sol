// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract OrderContract {
    enum OrderStatus { Pending, Processing, Shipped, Delivered, Confirmed, AdminValidated }
    
    string public companyName;
    uint public orderCount;
    address payable public owner;
    address public admin;
    mapping(address => bool) public sellerConfirmAllowed;

    constructor() {
        orderCount = 0;
        companyName = "LegitLah";
        owner = payable(msg.sender);
        admin = msg.sender;
    }

    struct Product {
        string name;
        uint price;
        string imageUrl;
        string description;
    }

    struct Order {
        uint orderId;
        address payable buyer;
        address payable seller;
        string buyerName;
        string deliveryAddress;
        Product product;
        uint totalAmount;
        OrderStatus status;
        uint timestamp;
        bool isPaid;
        bool isReleased;
        uint deliveredAt; 
    }

    struct TrackingUpdate {
        string status;
        string description;
        uint timestamp;
    }

    mapping(uint => Order) public orders;
    mapping(uint => TrackingUpdate[]) public trackingHistory;
    mapping(address => uint[]) public userOrders;
    mapping(uint => string) public trackingNumbers; // Store tracking numbers

    event OrderCreated(uint orderId, address buyer, uint amount);
    event OrderPaid(uint orderId, address buyer, uint amount);
    event PaymentHeld(uint orderId, address payer, uint amount);
    event OrderStatusUpdated(uint orderId, OrderStatus status);
    event DeliveryConfirmed(uint orderId, address buyer);
    event DeliveryValidated(uint orderId, address admin);
    event TrackingNumberUpdated(uint orderId, string trackingNumber);
    event SellerConfirmAllowed(address seller, bool allowed);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    function setAdmin(address _admin) external onlyOwner {
        require(_admin != address(0), "Invalid admin");
        admin = _admin;
    }

    // Allow changing the store owner (merchant) wallet
    function setOwner(address payable newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }

    function setSellerConfirmAllowed(address seller, bool allowed) external onlyOwner {
        require(seller != address(0), "Invalid seller");
        sellerConfirmAllowed[seller] = allowed;
        emit SellerConfirmAllowed(seller, allowed);
    }

    // Create a new order
    function createOrder(
        string memory _buyerName,
        string memory _deliveryAddress,
        string memory _productName,
        uint _price,
        string memory _imageUrl,
        string memory _description
    ) public payable returns (uint) {
        require(msg.value >= _price, "Insufficient payment for order");
        
        orderCount++;
        
        Product memory newProduct = Product({
            name: _productName,
            price: _price,
            imageUrl: _imageUrl,
            description: _description
        });
        
        orders[orderCount] = Order({
            orderId: orderCount,
            buyer: payable(msg.sender),
            seller: owner,
            buyerName: _buyerName,
            deliveryAddress: _deliveryAddress,
            product: newProduct,
            // Track actual ETH paid into escrow
            totalAmount: msg.value,
            status: OrderStatus.Pending,
            timestamp: block.timestamp,
            isPaid: true,
            isReleased: false,
            deliveredAt: 0
        });
        
        userOrders[msg.sender].push(orderCount);
        
        // Add initial tracking
        trackingHistory[orderCount].push(TrackingUpdate({
            status: "Order Created",
            description: "Your order has been created and is pending",
            timestamp: block.timestamp
        }));
        
        emit OrderCreated(orderCount, msg.sender, _price);
        emit OrderPaid(orderCount, msg.sender, msg.value);
        emit PaymentHeld(orderCount, msg.sender, msg.value);
        return orderCount;
    }

    // Pay for order (kept for backward compatibility)
    function payForOrder(uint _orderId) public payable {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        Order storage order = orders[_orderId];
        require(msg.sender == order.buyer, "Only buyer can pay");
        require(!order.isPaid, "Order already paid");
        require(msg.value >= order.product.price, "Insufficient payment");
        
        order.isPaid = true;
        // Record actual ETH paid so escrow matches payment value
        order.totalAmount = msg.value;
        order.status = OrderStatus.Processing;
        
        trackingHistory[_orderId].push(TrackingUpdate({
            status: "Payment Received",
            description: "Payment has been received and order is being processed",
            timestamp: block.timestamp
        }));
        
        emit OrderPaid(_orderId, msg.sender, msg.value);
        emit PaymentHeld(_orderId, msg.sender, msg.value);
        emit OrderStatusUpdated(_orderId, OrderStatus.Processing);
    }

    // Update order status (only contract owner or authorized parties)
    function updateOrderStatus(uint _orderId, OrderStatus _status, string memory _description) public {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        Order storage order = orders[_orderId];
        require(
            msg.sender == order.seller || msg.sender == admin || msg.sender == owner || sellerConfirmAllowed[msg.sender],
            "Not authorized to update status"
        );
        
        order.status = _status;
        
        string memory statusText;
        if (_status == OrderStatus.Processing) {
            statusText = "Processing";
        } else if (_status == OrderStatus.Shipped) {
            statusText = "Shipped";
        } else if (_status == OrderStatus.Delivered) {
            statusText = "Delivered";
            if (order.deliveredAt == 0) {
                order.deliveredAt = block.timestamp;
            }
        } else if (_status == OrderStatus.Confirmed) {
            statusText = "Confirmed";
        } else if (_status == OrderStatus.AdminValidated) {
            statusText = "Admin Validated";
        }
        
        trackingHistory[_orderId].push(TrackingUpdate({
            status: statusText,
            description: _description,
            timestamp: block.timestamp
        }));
        
        emit OrderStatusUpdated(_orderId, _status);
    }

    // Update order status with tracking number (for shipping)
    function updateOrderStatusWithTracking(uint _orderId, OrderStatus _status, string memory _description, string memory _trackingNumber) public {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        Order storage order = orders[_orderId];
        require(
            msg.sender == order.seller || msg.sender == admin || msg.sender == owner || sellerConfirmAllowed[msg.sender],
            "Not authorized to update status"
        );
        
        order.status = _status;
        
        // Store tracking number if status is Shipped
        if (_status == OrderStatus.Shipped && bytes(_trackingNumber).length > 0) {
            trackingNumbers[_orderId] = _trackingNumber;
            emit TrackingNumberUpdated(_orderId, _trackingNumber);
        }
        
        string memory statusText;
        if (_status == OrderStatus.Processing) {
            statusText = "Processing";
        } else if (_status == OrderStatus.Shipped) {
            statusText = "Shipped";
        } else if (_status == OrderStatus.Delivered) {
            statusText = "Delivered";
            if (order.deliveredAt == 0) {
                order.deliveredAt = block.timestamp;
            }
        } else if (_status == OrderStatus.Confirmed) {
            statusText = "Confirmed";
        } else if (_status == OrderStatus.AdminValidated) {
            statusText = "Admin Validated";
        }
        
        trackingHistory[_orderId].push(TrackingUpdate({
            status: statusText,
            description: _description,
            timestamp: block.timestamp
        }));
        
        emit OrderStatusUpdated(_orderId, _status);
    }

    // Confirm delivery by buyer
    function confirmDelivery(uint _orderId, bool _received) public {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        Order storage order = orders[_orderId];
        require(msg.sender == order.buyer, "Only buyer can confirm");
        require(order.status == OrderStatus.Delivered, "Order not yet delivered");
        
        if (_received) {
            require(order.isPaid, "Payment not held in escrow");
            require(!order.isReleased, "Payment already released");
            order.status = OrderStatus.Confirmed;
            order.isPaid = true;
            if (order.deliveredAt == 0) {
                order.deliveredAt = block.timestamp;
            }
            
            trackingHistory[_orderId].push(TrackingUpdate({
                status: "Confirmed",
                description: "Customer confirmed delivery; awaiting admin validation",
                timestamp: block.timestamp
            }));
            emit DeliveryConfirmed(_orderId, msg.sender);
        } else {
            trackingHistory[_orderId].push(TrackingUpdate({
                status: "Refund Requested",
                description: "Customer reported item not received",
                timestamp: block.timestamp
            }));
        }
    }

    // Admin validates delivery and releases funds
    function adminValidateDelivery(uint _orderId) external onlyAdmin {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Confirmed, "Order not buyer-confirmed");
        require(order.isPaid, "Payment not held");
        require(!order.isReleased, "Payment already released");

        order.isReleased = true;
        order.status = OrderStatus.AdminValidated;

        trackingHistory[_orderId].push(TrackingUpdate({
            status: "Admin Validated",
            description: "Admin validated delivery and released funds",
            timestamp: block.timestamp
        }));

        (bool success, ) = order.seller.call{value: order.totalAmount}("");
        require(success, "Payment release failed");

        emit DeliveryValidated(_orderId, msg.sender);
        emit OrderPaid(_orderId, msg.sender, order.totalAmount);
    }

    // View escrow/payment status for an order
    function getEscrowStatus(uint _orderId) public view returns (bool isEscrowed, bool isReleased, uint amount) {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        Order memory order = orders[_orderId];
        return (order.isPaid, order.isReleased, order.totalAmount);
    }

    // Get order details
    function getOrder(uint _orderId) public view returns (
        uint orderId,
        address buyer,
        address seller,
        string memory buyerName,
        string memory deliveryAddress,
        string memory productName,
        uint price,
        string memory imageUrl,
        uint totalAmount,
        OrderStatus status,
        uint timestamp,
        bool isPaid,
        bool isReleased,
        uint deliveredAt
    ) {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        Order memory order = orders[_orderId];
        
        return (
            order.orderId,
            order.buyer,
            order.seller,
            order.buyerName,
            order.deliveryAddress,
            order.product.name,
            order.product.price,
            order.product.imageUrl,
            order.totalAmount,
            order.status,
            order.timestamp,
            order.isPaid,
            order.isReleased,
            order.deliveredAt
        );
    }

    // Get tracking history
    function getTrackingHistory(uint _orderId) public view returns (TrackingUpdate[] memory) {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        return trackingHistory[_orderId];
    }

    // Get user's orders
    function getUserOrders(address _user) public view returns (uint[] memory) {
        return userOrders[_user];
    }

    // Get order count
    function getOrderCount() public view returns (uint) {
        return orderCount;
    }

    // Get complete tracking info - accessible by both buyer and seller
    function getFullTrackingInfo(uint _orderId) public view returns (
        uint orderId,
        string memory productName,
        string memory currentStatus,
        TrackingUpdate[] memory history
    ) {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        Order memory order = orders[_orderId];
        require(
            msg.sender == order.buyer || msg.sender == order.seller,
            "Only buyer or seller can view tracking information"
        );
        
        string memory statusText;
        if (order.status == OrderStatus.Processing) {
            statusText = "Processing";
        } else if (order.status == OrderStatus.Shipped) {
            statusText = "Shipped";
        } else if (order.status == OrderStatus.Delivered) {
            statusText = "Delivered";
        } else if (order.status == OrderStatus.Confirmed) {
            statusText = "Confirmed";
        } else if (order.status == OrderStatus.AdminValidated) {
            statusText = "Admin Validated";
        } else {
            statusText = "Pending";
        }
        
        return (
            orderId,
            order.product.name,
            statusText,
            trackingHistory[_orderId]
        );
    }

    // Update tracking number - can be called by seller or admin
    function updateTrackingNumber(uint _orderId, string memory _trackingNumber) public {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        require(bytes(_trackingNumber).length > 0, "Tracking number cannot be empty");
        
        Order storage order = orders[_orderId];
        require(msg.sender == order.seller || msg.sender == owner, "Only seller or owner can update tracking number");
        require(order.status == OrderStatus.Shipped, "Order must be shipped first");
        
        trackingNumbers[_orderId] = _trackingNumber;
        
        emit TrackingNumberUpdated(_orderId, _trackingNumber);
    }

    // Get tracking number - accessible by both buyer and seller
    function getTrackingNumber(uint _orderId) public view returns (string memory) {
        require(_orderId > 0 && _orderId <= orderCount, "Invalid order ID");
        Order memory order = orders[_orderId];
        
        // Allow any connected user to view if order exists - access control is lenient for tracking
        // But still check that order is in proper status
        if (order.status != OrderStatus.Shipped && order.status != OrderStatus.Delivered && order.status != OrderStatus.Confirmed) {
            return ""; // Return empty string if not shipped yet
        }
        
        return trackingNumbers[_orderId]; // Return tracking number (may be empty if not set)
    }
}
