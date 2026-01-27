// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract ProductContract {
    
    struct Product {
        uint productId;
        address seller;
        string name;
        uint price;
        string description;
        string imageUrl;
        uint timestamp;
        bool active;
    }

    uint public productCount;
    mapping(uint => Product) public products;
    mapping(address => uint[]) public sellerProducts; // Products for each seller
    mapping(uint => bool) public productExists;

    event ProductAdded(uint productId, address seller, string name, uint price);
    event ProductUpdated(uint productId, address seller, string name, uint price);
    event ProductDeactivated(uint productId, address seller);
    event ProductReactivated(uint productId, address seller);

    constructor() {
        productCount = 0;
    }

    // Add a new product
    function addProduct(
        string memory name,
        uint price,
        string memory description,
        string memory imageUrl
    ) public returns (uint) {
        require(bytes(name).length > 0, "Product name cannot be empty");
        require(price > 0, "Price must be greater than 0");
        require(bytes(description).length > 0, "Description cannot be empty");

        uint productId = productCount;
        
        products[productId] = Product({
            productId: productId,
            seller: msg.sender,
            name: name,
            price: price,
            description: description,
            imageUrl: imageUrl,
            timestamp: block.timestamp,
            active: true
        });

        sellerProducts[msg.sender].push(productId);
        productExists[productId] = true;
        productCount++;

        emit ProductAdded(productId, msg.sender, name, price);
        return productId;
    }

    // Update product details (only by seller)
    function updateProduct(
        uint productId,
        string memory name,
        uint price,
        string memory description,
        string memory imageUrl
    ) public returns (bool) {
        require(productExists[productId], "Product does not exist");
        Product storage product = products[productId];
        require(product.seller == msg.sender, "Only seller can update product");
        require(bytes(name).length > 0, "Product name cannot be empty");
        require(price > 0, "Price must be greater than 0");

        product.name = name;
        product.price = price;
        product.description = description;
        product.imageUrl = imageUrl;

        emit ProductUpdated(productId, msg.sender, name, price);
        return true;
    }

    // Deactivate product (soft delete)
    function deactivateProduct(uint productId) public returns (bool) {
        require(productExists[productId], "Product does not exist");
        Product storage product = products[productId];
        require(product.seller == msg.sender, "Only seller can deactivate product");

        product.active = false;

        emit ProductDeactivated(productId, msg.sender);
        return true;
    }

    // Reactivate product
    function reactivateProduct(uint productId) public returns (bool) {
        require(productExists[productId], "Product does not exist");
        Product storage product = products[productId];
        require(product.seller == msg.sender, "Only seller can reactivate product");

        product.active = true;

        emit ProductReactivated(productId, msg.sender);
        return true;
    }

    // Get product details
    function getProduct(uint productId) public view returns (Product memory) {
        require(productExists[productId], "Product does not exist");
        return products[productId];
    }

    // Get all active products
    function getAllProducts() public view returns (Product[] memory) {
        uint activeCount = 0;
        
        // Count active products
        for (uint i = 0; i < productCount; i++) {
            if (products[i].active) {
                activeCount++;
            }
        }
        
        // Create array of active products
        Product[] memory activeProducts = new Product[](activeCount);
        uint index = 0;
        
        for (uint i = 0; i < productCount; i++) {
            if (products[i].active) {
                activeProducts[index] = products[i];
                index++;
            }
        }
        
        return activeProducts;
    }

    // Get all products (including inactive)
    function getAllProductsIncludeInactive() public view returns (Product[] memory) {
        Product[] memory allProducts = new Product[](productCount);
        
        for (uint i = 0; i < productCount; i++) {
            allProducts[i] = products[i];
        }
        
        return allProducts;
    }

    // Get seller's products
    function getSellerProducts(address seller) public view returns (uint[] memory) {
        return sellerProducts[seller];
    }

    // Get seller's active products
    function getSellerActiveProducts(address seller) public view returns (Product[] memory) {
        uint[] memory sellerProductIds = sellerProducts[seller];
        uint activeCount = 0;
        
        // Count active products for seller
        for (uint i = 0; i < sellerProductIds.length; i++) {
            if (products[sellerProductIds[i]].active) {
                activeCount++;
            }
        }
        
        // Create array of active products
        Product[] memory activeProducts = new Product[](activeCount);
        uint index = 0;
        
        for (uint i = 0; i < sellerProductIds.length; i++) {
            uint productId = sellerProductIds[i];
            if (products[productId].active) {
                activeProducts[index] = products[productId];
                index++;
            }
        }
        
        return activeProducts;
    }

    // Get seller's product count
    function getSellerProductCount(address seller) public view returns (uint) {
        return sellerProducts[seller].length;
    }

    // Get product count (total active)
    function getActiveProductCount() public view returns (uint) {
        uint count = 0;
        for (uint i = 0; i < productCount; i++) {
            if (products[i].active) {
                count++;
            }
        }
        return count;
    }

    // Check if product is active
    function isProductActive(uint productId) public view returns (bool) {
        require(productExists[productId], "Product does not exist");
        return products[productId].active;
    }

    // Get recent products
    function getRecentProducts(uint count) public view returns (Product[] memory) {
        uint[] memory activeIds = new uint[](productCount);
        uint activeCount = 0;
        
        // Get all active product IDs
        for (uint i = 0; i < productCount; i++) {
            if (products[i].active) {
                activeIds[activeCount] = i;
                activeCount++;
            }
        }
        
        // Return the last 'count' products
        uint returnCount = activeCount > count ? count : activeCount;
        Product[] memory recentProducts = new Product[](returnCount);
        
        for (uint i = 0; i < returnCount; i++) {
            uint idx = activeCount - 1 - i;
            recentProducts[i] = products[activeIds[idx]];
        }
        
        return recentProducts;
    }
}
