// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract ReviewContract {
    
    struct Review {
        uint reviewId;
        uint orderId;
        address buyer;
        address seller;
        uint productId;
        string productName;
        uint stars; // 1-5
        string comment;
        uint timestamp;
        uint lastUpdated;
        bool edited;
    }

    struct SellerReputation {
        uint totalReviews;
        uint totalStars;
        uint averageRating; // Stored as rating * 100 (e.g., 4.5 = 450)
    }

    uint public reviewCount;
    mapping(uint => Review) public reviews;
    mapping(address => uint[]) public sellerReviews; // Reviews for each seller
    mapping(address => SellerReputation) public sellerReputation;
    mapping(uint => bool) public orderReviewed; // Track if order already has a review
    mapping(uint => uint) public orderToReviewId; // Map order ID to review ID
    mapping(address => uint) public buyerReviewCount; // Track reviews given by buyers

    event ReviewSubmitted(uint reviewId, uint orderId, address buyer, address seller, uint stars);
    event ReviewEdited(uint reviewId, uint orderId, address buyer, address seller, uint newStars);
    event ReputationUpdated(address seller, uint totalReviews, uint averageRating);

    constructor() {
        reviewCount = 0;
    }

    // Submit a review for a completed order
    function submitReview(
        uint orderId,
        address seller,
        uint productId,
        string memory productName,
        uint stars,
        string memory comment
    ) public returns (bool) {
        require(stars >= 1 && stars <= 5, "Stars must be between 1 and 5");
        require(!orderReviewed[orderId], "Order already has a review");
        require(bytes(productName).length > 0, "Product name cannot be empty");

        uint reviewId = reviewCount;
        
        reviews[reviewId] = Review({
            reviewId: reviewId,
            orderId: orderId,
            buyer: msg.sender,
            seller: seller,
            productId: productId,
            productName: productName,
            stars: stars,
            comment: comment,
            timestamp: block.timestamp,
            lastUpdated: block.timestamp,
            edited: false
        });

        sellerReviews[seller].push(reviewId);
        orderReviewed[orderId] = true;
        orderToReviewId[orderId] = reviewId;
        buyerReviewCount[msg.sender]++;

        // Update seller reputation
        updateSellerReputation(seller);

        reviewCount++;

        emit ReviewSubmitted(reviewId, orderId, msg.sender, seller, stars);
        return true;
    }

    // Edit an existing review (only by the buyer who submitted it)
    function editReview(
        uint reviewId,
        uint newStars,
        string memory newComment
    ) public returns (bool) {
        Review storage review = reviews[reviewId];
        require(review.buyer == msg.sender, "Only the reviewer can edit their review");
        require(newStars >= 1 && newStars <= 5, "Stars must be between 1 and 5");

        review.stars = newStars;
        review.comment = newComment;
        review.lastUpdated = block.timestamp;
        review.edited = true;

        // Update seller reputation
        updateSellerReputation(review.seller);

        emit ReviewEdited(reviewId, review.orderId, msg.sender, review.seller, newStars);
        return true;
    }

    // Update seller's average rating
    function updateSellerReputation(address seller) private {
        uint[] memory reviewIds = sellerReviews[seller];
        if (reviewIds.length == 0) {
            return;
        }

        uint totalStars = 0;
        for (uint i = 0; i < reviewIds.length; i++) {
            totalStars += reviews[reviewIds[i]].stars;
        }

        uint averageRating = (totalStars * 100) / reviewIds.length;

        sellerReputation[seller] = SellerReputation({
            totalReviews: reviewIds.length,
            totalStars: totalStars,
            averageRating: averageRating
        });

        emit ReputationUpdated(seller, reviewIds.length, averageRating);
    }

    // Get all reviews for a seller
    function getSellerReviews(address seller) public view returns (uint[] memory) {
        return sellerReviews[seller];
    }

    // Get review details
    function getReview(uint reviewId) public view returns (Review memory) {
        return reviews[reviewId];
    }

    // Get seller reputation
    function getSellerReputation(address seller) public view returns (SellerReputation memory) {
        return sellerReputation[seller];
    }

    // Get average rating as decimal (e.g., 4.5 = 4.5, 4.0 = 4.0)
    function getSellerAverageRating(address seller) public view returns (uint) {
        return sellerReputation[seller].averageRating;
    }

    // Check if order has been reviewed
    function isOrderReviewed(uint orderId) public view returns (bool) {
        return orderReviewed[orderId];
    }

    // Get review ID for an order
    function getOrderReviewId(uint orderId) public view returns (uint) {
        return orderToReviewId[orderId];
    }

    // Get total reviews given by a buyer
    function getBuyerReviewCount(address buyer) public view returns (uint) {
        return buyerReviewCount[buyer];
    }

    // Get recent reviews (last N reviews)
    function getRecentReviews(address seller, uint count) public view returns (Review[] memory) {
        uint[] memory reviewIds = sellerReviews[seller];
        uint length = reviewIds.length > count ? count : reviewIds.length;
        
        Review[] memory recentReviews = new Review[](length);
        
        // Get the last 'length' reviews
        for (uint i = 0; i < length; i++) {
            uint idx = reviewIds.length - 1 - i;
            recentReviews[i] = reviews[reviewIds[idx]];
        }
        
        return recentReviews;
    }

    // Check if buyer can edit a review (must be the reviewer)
    function canEditReview(uint reviewId, address requester) public view returns (bool) {
        return reviews[reviewId].buyer == requester;
    }
}
