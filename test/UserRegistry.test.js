const UserRegistry = artifacts.require("UserRegistry");
const Web3 = require('web3');

contract("UserRegistry - Authentication and User Management", (accounts) => {
    let contract;
    const admin = accounts[0];
    const user1 = accounts[1];
    const user2 = accounts[2];
    const seller1 = accounts[3];
    const seller2 = accounts[4];
    const unauthorized = accounts[5];

    // Test user credentials
    const testUsers = {
        buyer: {
            email: "buyer@test.com",
            password: "buyerPass123",
            role: 1 // Role.User
        },
        seller: {
            email: "seller@test.com",
            password: "sellerPass123",
            role: 2 // Role.Seller
        },
        admin: {
            email: "admin@test.com",
            password: "adminPass123",
            role: 3 // Role.Admin
        },
        buyer2: {
            email: "buyer2@test.com",
            password: "buyer2Pass123",
            role: 1 // Role.User
        }
    };

    // Helper function to hash email
    function hashEmail(email) {
        return Web3.utils.keccak256(email.trim().toLowerCase());
    }

    // Helper function to hash password
    function hashPassword(password) {
        return Web3.utils.keccak256(password);
    }

    // Deploy contract before each test
    beforeEach(async () => {
        contract = await UserRegistry.new({ from: admin });
    });

    // =====================================================
    // TEST 1: Contract Initialization
    // =====================================================
    describe("Contract Initialization", () => {
        it("should deploy with admin account", async () => {
            const role = await contract.getRole(admin);
            assert.equal(role.toString(), "3", "Deployer should be admin");
        });

        it("should start with 0 users", async () => {
            const count = await contract.getUserCount();
            assert.equal(count.toString(), "0", "Initial user count should be 0");
        });

        it("should recognize deployer as registered", async () => {
            const isReg = await contract.isRegistered(admin);
            assert.equal(isReg, true, "Admin should be registered");
        });
    });

    // =====================================================
    // TEST 2: User Registration (Sign Up)
    // =====================================================
    describe("registerUserByEmailWithRole() - User Sign Up", () => {
        it("should register a new buyer account", async () => {
            const emailHash = hashEmail(testUsers.buyer.email);
            const passwordHash = hashPassword(testUsers.buyer.password);

            await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                testUsers.buyer.role,
                { from: admin }
            );

            const userCount = await contract.getUserCount();
            assert.equal(userCount.toString(), "1", "User count should be 1");
        });

        it("should register a new seller account with dropdown selection", async () => {
            const emailHash = hashEmail(testUsers.seller.email);
            const passwordHash = hashPassword(testUsers.seller.password);

            const tx = await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                testUsers.seller.role,
                { from: admin }
            );

            // Check event emission
            assert.equal(tx.logs.length, 1, "Should emit one event");
            assert.equal(tx.logs[0].event, "UserRegistered", "Should emit UserRegistered event");
            assert.equal(tx.logs[0].args.role.toString(), "2", "Role should be Seller");
        });

        it("should register multiple users with different roles", async () => {
            const buyerEmailHash = hashEmail(testUsers.buyer.email);
            const buyerPasswordHash = hashPassword(testUsers.buyer.password);
            const sellerEmailHash = hashEmail(testUsers.seller.email);
            const sellerPasswordHash = hashPassword(testUsers.seller.password);

            await contract.registerUserByEmailWithRole(
                buyerEmailHash,
                buyerPasswordHash,
                1,
                { from: admin }
            );

            await contract.registerUserByEmailWithRole(
                sellerEmailHash,
                sellerPasswordHash,
                2,
                { from: admin }
            );

            const userCount = await contract.getUserCount();
            assert.equal(userCount.toString(), "2", "Should have 2 users registered");
        });

        it("should reject registration with empty email", async () => {
            const emptyEmailHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
            const passwordHash = hashPassword(testUsers.buyer.password);

            try {
                await contract.registerUserByEmailWithRole(
                    emptyEmailHash,
                    passwordHash,
                    1,
                    { from: admin }
                );
                assert.fail("Should reject empty email");
            } catch (error) {
                assert.include(error.message, "Email required", "Should reject empty email");
            }
        });

        it("should reject registration with empty password", async () => {
            const emailHash = hashEmail(testUsers.buyer.email);
            const emptyPasswordHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

            try {
                await contract.registerUserByEmailWithRole(
                    emailHash,
                    emptyPasswordHash,
                    1,
                    { from: admin }
                );
                assert.fail("Should reject empty password");
            } catch (error) {
                assert.include(error.message, "Password required", "Should reject empty password");
            }
        });

        it("should reject duplicate email registration", async () => {
            const emailHash = hashEmail(testUsers.buyer.email);
            const passwordHash = hashPassword(testUsers.buyer.password);

            await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                1,
                { from: admin }
            );

            try {
                await contract.registerUserByEmailWithRole(
                    emailHash,
                    passwordHash,
                    1,
                    { from: admin }
                );
                assert.fail("Should reject duplicate email");
            } catch (error) {
                assert.include(error.message, "Email already used", "Should reject duplicate email");
            }
        });

        it("should reject registration from non-admin", async () => {
            const emailHash = hashEmail(testUsers.buyer.email);
            const passwordHash = hashPassword(testUsers.buyer.password);

            try {
                await contract.registerUserByEmailWithRole(
                    emailHash,
                    passwordHash,
                    1,
                    { from: unauthorized }
                );
                assert.fail("Should reject registration from non-admin");
            } catch (error) {
                assert.include(error.message, "Only admin", "Should require admin");
            }
        });

        it("should handle password confirmation mismatch in frontend", async () => {
            // This test simulates the validation that happens in the frontend
            // In real usage, mismatched passwords would be caught before blockchain call
            const emailHash = hashEmail(testUsers.buyer.email);
            const password1Hash = hashPassword("password123");
            const password2Hash = hashPassword("password456");

            // These hashes should be different
            assert.notEqual(password1Hash, password2Hash, "Different passwords should have different hashes");
        });
    });

    // =====================================================
    // TEST 3: User Login - Credential Verification
    // =====================================================
    describe("verifyCredentials() - User Login", () => {
        beforeEach(async () => {
            // Register test users before login tests
            const buyerEmailHash = hashEmail(testUsers.buyer.email);
            const buyerPasswordHash = hashPassword(testUsers.buyer.password);
            await contract.registerUserByEmailWithRole(
                buyerEmailHash,
                buyerPasswordHash,
                1,
                { from: admin }
            );

            const sellerEmailHash = hashEmail(testUsers.seller.email);
            const sellerPasswordHash = hashPassword(testUsers.seller.password);
            await contract.registerUserByEmailWithRole(
                sellerEmailHash,
                sellerPasswordHash,
                2,
                { from: admin }
            );
        });

        it("should successfully login buyer with correct credentials", async () => {
            const emailHash = hashEmail(testUsers.buyer.email);
            const passwordHash = hashPassword(testUsers.buyer.password);

            const result = await contract.verifyCredentials(emailHash, passwordHash);

            assert.equal(result.isValid, true, "Login should be successful");
            assert.equal(result.role.toString(), "1", "Role should be User/Buyer");
        });

        it("should successfully login seller with correct credentials", async () => {
            const emailHash = hashEmail(testUsers.seller.email);
            const passwordHash = hashPassword(testUsers.seller.password);

            const result = await contract.verifyCredentials(emailHash, passwordHash);

            assert.equal(result.isValid, true, "Login should be successful");
            assert.equal(result.role.toString(), "2", "Role should be Seller");
        });

        it("should redirect to seller interface after seller login", async () => {
            const emailHash = hashEmail(testUsers.seller.email);
            const passwordHash = hashPassword(testUsers.seller.password);

            const result = await contract.verifyCredentials(emailHash, passwordHash);

            assert.equal(result.isValid, true, "Login should be successful");
            assert.equal(result.role.toString(), "2", "Should have seller role for /seller redirect");
        });

        it("should redirect to buyer interface after buyer login", async () => {
            const emailHash = hashEmail(testUsers.buyer.email);
            const passwordHash = hashPassword(testUsers.buyer.password);

            const result = await contract.verifyCredentials(emailHash, passwordHash);

            assert.equal(result.isValid, true, "Login should be successful");
            assert.equal(result.role.toString(), "1", "Should have user role for /user-home redirect");
        });

        it("should reject login with incorrect password", async () => {
            const emailHash = hashEmail(testUsers.buyer.email);
            const wrongPasswordHash = hashPassword("wrongPassword");

            const result = await contract.verifyCredentials(emailHash, wrongPasswordHash);

            assert.equal(result.isValid, false, "Login should fail");
            assert.equal(result.role.toString(), "0", "Role should be None");
        });

        it("should reject login with non-existent email", async () => {
            const nonExistentEmailHash = hashEmail("nonexistent@test.com");
            const passwordHash = hashPassword("anyPassword");

            const result = await contract.verifyCredentials(nonExistentEmailHash, passwordHash);

            assert.equal(result.isValid, false, "Login should fail");
            assert.equal(result.role.toString(), "0", "Role should be None");
        });

        it("should handle email case normalization", async () => {
            const emailLower = hashEmail("buyer@test.com");
            const emailUpper = hashEmail("BUYER@TEST.COM");
            const emailMixed = hashEmail("BuYeR@TeSt.CoM");

            // All should produce the same hash due to normalization
            assert.equal(emailLower, emailUpper, "Email hashes should match regardless of case");
            assert.equal(emailLower, emailMixed, "Email hashes should match regardless of case");
        });
    });

    // =====================================================
    // TEST 4: Admin Login - Separate Admin Portal
    // =====================================================
    describe("Admin Authentication", () => {
        beforeEach(async () => {
            // Create a test admin user
            const adminEmailHash = hashEmail(testUsers.admin.email);
            const adminPasswordHash = hashPassword(testUsers.admin.password);
            
            // First register as user, then promote to admin
            await contract.registerUserByEmailWithRole(
                adminEmailHash,
                adminPasswordHash,
                1,
                { from: admin }
            );
            
            await contract.setAdminByEmailHash(adminEmailHash, { from: admin });
        });

        it("should successfully login admin with correct credentials", async () => {
            const emailHash = hashEmail(testUsers.admin.email);
            const passwordHash = hashPassword(testUsers.admin.password);

            const result = await contract.verifyCredentials(emailHash, passwordHash);

            assert.equal(result.isValid, true, "Admin login should be successful");
            assert.equal(result.role.toString(), "3", "Role should be Admin");
        });

        it("should redirect admin to /admin dashboard", async () => {
            const emailHash = hashEmail(testUsers.admin.email);
            const passwordHash = hashPassword(testUsers.admin.password);

            const result = await contract.verifyCredentials(emailHash, passwordHash);

            assert.equal(result.isValid, true, "Login should be successful");
            assert.equal(result.role.toString(), "3", "Should have admin role for /admin redirect");
        });

        it("should reject non-admin login at admin portal", async () => {
            const buyerEmailHash = hashEmail(testUsers.buyer.email);
            const buyerPasswordHash = hashPassword(testUsers.buyer.password);
            
            // Register a buyer
            await contract.registerUserByEmailWithRole(
                buyerEmailHash,
                buyerPasswordHash,
                1,
                { from: admin }
            );

            const result = await contract.verifyCredentials(buyerEmailHash, buyerPasswordHash);

            assert.equal(result.isValid, true, "Credentials are valid");
            assert.notEqual(result.role.toString(), "3", "But role is not admin");
            // In the app, this would trigger: "Invalid admin credentials"
        });

        it("should allow admin to perform admin-only functions", async () => {
            const adminEmailHash = hashEmail(testUsers.admin.email);
            const passwordHash = hashPassword(testUsers.admin.password);

            const result = await contract.verifyCredentials(adminEmailHash, passwordHash);
            assert.equal(result.role.toString(), "3", "User is admin");

            // Verify admin can promote users
            const newUserEmailHash = hashEmail(testUsers.buyer2.email);
            const newUserPasswordHash = hashPassword(testUsers.buyer2.password);
            
            await contract.registerUserByEmailWithRole(
                newUserEmailHash,
                newUserPasswordHash,
                1,
                { from: admin }
            );

            // This should succeed since deployer is admin
            await contract.setAdminByEmailHash(newUserEmailHash, { from: admin });

            const newUserRole = await contract.verifyCredentials(newUserEmailHash, newUserPasswordHash);
            assert.equal(newUserRole.role.toString(), "3", "User should be promoted to admin");
        });
    });

    // =====================================================
    // TEST 5: Role-Based Access Control
    // =====================================================
    describe("Role-Based Interface Access", () => {
        beforeEach(async () => {
            // Register users with different roles
            const buyerEmailHash = hashEmail(testUsers.buyer.email);
            const buyerPasswordHash = hashPassword(testUsers.buyer.password);
            await contract.registerUserByEmailWithRole(
                buyerEmailHash,
                buyerPasswordHash,
                1,
                { from: admin }
            );

            const sellerEmailHash = hashEmail(testUsers.seller.email);
            const sellerPasswordHash = hashPassword(testUsers.seller.password);
            await contract.registerUserByEmailWithRole(
                sellerEmailHash,
                sellerPasswordHash,
                2,
                { from: admin }
            );
        });

        it("should identify buyer role for user interface", async () => {
            const emailHash = hashEmail(testUsers.buyer.email);
            const passwordHash = hashPassword(testUsers.buyer.password);

            const result = await contract.verifyCredentials(emailHash, passwordHash);
            
            assert.equal(result.role.toString(), "1", "Role should be User/Buyer");
            // In app.js, role '1' redirects to /user-home
        });

        it("should identify seller role for seller interface", async () => {
            const emailHash = hashEmail(testUsers.seller.email);
            const passwordHash = hashPassword(testUsers.seller.password);

            const result = await contract.verifyCredentials(emailHash, passwordHash);
            
            assert.equal(result.role.toString(), "2", "Role should be Seller");
            // In app.js, role '2' redirects to /seller
        });

        it("should support account type dropdown selection during signup", async () => {
            // Test that we can register different account types
            const buyer3EmailHash = hashEmail("buyer3@test.com");
            const seller3EmailHash = hashEmail("seller3@test.com");
            const passwordHash = hashPassword("testPass123");

            // Simulate dropdown selection: "user" (buyer)
            await contract.registerUserByEmailWithRole(
                buyer3EmailHash,
                passwordHash,
                1, // roleMap['user'] = 1
                { from: admin }
            );

            // Simulate dropdown selection: "seller"
            await contract.registerUserByEmailWithRole(
                seller3EmailHash,
                passwordHash,
                2, // roleMap['seller'] = 2
                { from: admin }
            );

            const buyerResult = await contract.verifyCredentials(buyer3EmailHash, passwordHash);
            const sellerResult = await contract.verifyCredentials(seller3EmailHash, passwordHash);

            assert.equal(buyerResult.role.toString(), "1", "Buyer role should be set");
            assert.equal(sellerResult.role.toString(), "2", "Seller role should be set");
        });
    });

    // =====================================================
    // TEST 6: User Management and Queries
    // =====================================================
    describe("User Management Functions", () => {
        beforeEach(async () => {
            const buyerEmailHash = hashEmail(testUsers.buyer.email);
            const buyerPasswordHash = hashPassword(testUsers.buyer.password);
            await contract.registerUserByEmailWithRole(
                buyerEmailHash,
                buyerPasswordHash,
                1,
                { from: admin }
            );

            const sellerEmailHash = hashEmail(testUsers.seller.email);
            const sellerPasswordHash = hashPassword(testUsers.seller.password);
            await contract.registerUserByEmailWithRole(
                sellerEmailHash,
                sellerPasswordHash,
                2,
                { from: admin }
            );
        });

        it("should return correct user count", async () => {
            const count = await contract.getUserCount();
            assert.equal(count.toString(), "2", "Should have 2 registered users");
        });

        it("should retrieve user by index", async () => {
            const user = await contract.getUserByIndex(0);
            assert.notEqual(user.emailHash, "0x0000000000000000000000000000000000000000000000000000000000000000", "Email hash should be set");
            assert.notEqual(user.role.toString(), "0", "Role should not be None");
        });

        it("should check if user is registered", async () => {
            const buyerEmailHash = hashEmail(testUsers.buyer.email);
            
            // Since wallet is not set during admin registration, we can't check by account
            // But we can verify the user exists through getUserCount and getUserByIndex
            const count = await contract.getUserCount();
            assert.isTrue(count.toNumber() > 0, "Should have registered users");
        });

        it("should promote user to admin", async () => {
            const buyerEmailHash = hashEmail(testUsers.buyer.email);
            const passwordHash = hashPassword(testUsers.buyer.password);

            // Verify user is not admin
            let result = await contract.verifyCredentials(buyerEmailHash, passwordHash);
            assert.equal(result.role.toString(), "1", "User should start as buyer");

            // Promote to admin
            await contract.setAdminByEmailHash(buyerEmailHash, { from: admin });

            // Verify user is now admin
            result = await contract.verifyCredentials(buyerEmailHash, passwordHash);
            assert.equal(result.role.toString(), "3", "User should now be admin");
        });

        it("should reject admin promotion from non-admin", async () => {
            const buyerEmailHash = hashEmail(testUsers.buyer.email);

            try {
                await contract.setAdminByEmailHash(buyerEmailHash, { from: unauthorized });
                assert.fail("Should reject promotion from non-admin");
            } catch (error) {
                assert.include(error.message, "Only admin", "Should require admin privilege");
            }
        });
    });

    // =====================================================
    // TEST 7: Edge Cases and Security
    // =====================================================
    describe("Security and Edge Cases", () => {
        it("should handle special characters in email", async () => {
            const specialEmail = "user+test@example.com";
            const emailHash = hashEmail(specialEmail);
            const passwordHash = hashPassword("password123");

            await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                1,
                { from: admin }
            );

            const result = await contract.verifyCredentials(emailHash, passwordHash);
            assert.equal(result.isValid, true, "Should handle special characters in email");
        });

        it("should handle special characters in password", async () => {
            const emailHash = hashEmail("user@test.com");
            const specialPassword = "P@ssw0rd!#$%";
            const passwordHash = hashPassword(specialPassword);

            await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                1,
                { from: admin }
            );

            const result = await contract.verifyCredentials(emailHash, passwordHash);
            assert.equal(result.isValid, true, "Should handle special characters in password");
        });

        it("should handle long passwords", async () => {
            const emailHash = hashEmail("user@test.com");
            const longPassword = "a".repeat(100);
            const passwordHash = hashPassword(longPassword);

            await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                1,
                { from: admin }
            );

            const result = await contract.verifyCredentials(emailHash, passwordHash);
            assert.equal(result.isValid, true, "Should handle long passwords");
        });

        it("should maintain password security through hashing", async () => {
            const password1 = "password123";
            const password2 = "password124";
            const hash1 = hashPassword(password1);
            const hash2 = hashPassword(password2);

            // Similar passwords should have completely different hashes
            assert.notEqual(hash1, hash2, "Hashes should be different");
            assert.equal(hash1.length, hash2.length, "Hashes should be same length");
        });

        it("should maintain email privacy through hashing", async () => {
            const email = "private@test.com";
            const emailHash = hashEmail(email);

            // Hash should not reveal original email
            assert.notInclude(emailHash, "private", "Hash should not contain email text");
            assert.notInclude(emailHash, "test.com", "Hash should not contain domain");
        });
    });

    // =====================================================
    // TEST 8: Complete User Journey
    // =====================================================
    describe("Complete Authentication Flow", () => {
        it("should complete full buyer signup and login flow", async () => {
            // Step 1: User visits signup page and fills form
            const email = "newbuyer@test.com";
            const password = "buyerPassword123";
            const accountType = "user"; // Dropdown selection

            // Step 2: Hash credentials
            const emailHash = hashEmail(email);
            const passwordHash = hashPassword(password);

            // Step 3: Register (equivalent to POST /signup)
            const roleMap = { user: 1, seller: 2 };
            await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                roleMap[accountType],
                { from: admin }
            );

            // Step 4: Redirect to login page (GET /login)
            // Step 5: User enters credentials and submits (POST /login)
            const loginResult = await contract.verifyCredentials(emailHash, passwordHash);

            // Step 6: Verify login successful
            assert.equal(loginResult.isValid, true, "Login should succeed");
            assert.equal(loginResult.role.toString(), "1", "Should have buyer role");

            // Step 7: System redirects to /user-home
            // (In app.js: if role === '1', redirect to /user-home)
        });

        it("should complete full seller signup and login flow", async () => {
            const email = "newseller@test.com";
            const password = "sellerPassword123";
            const accountType = "seller"; // Dropdown selection

            const emailHash = hashEmail(email);
            const passwordHash = hashPassword(password);

            const roleMap = { user: 1, seller: 2 };
            await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                roleMap[accountType],
                { from: admin }
            );

            const loginResult = await contract.verifyCredentials(emailHash, passwordHash);

            assert.equal(loginResult.isValid, true, "Login should succeed");
            assert.equal(loginResult.role.toString(), "2", "Should have seller role");
            // System would redirect to /seller
        });

        it("should complete admin login flow through admin portal", async () => {
            const email = "admin@test.com";
            const password = "adminPassword123";

            const emailHash = hashEmail(email);
            const passwordHash = hashPassword(password);

            // Register and promote to admin
            await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                1,
                { from: admin }
            );
            await contract.setAdminByEmailHash(emailHash, { from: admin });

            // Admin visits /admin-login (separate from /login)
            const loginResult = await contract.verifyCredentials(emailHash, passwordHash);

            assert.equal(loginResult.isValid, true, "Login should succeed");
            assert.equal(loginResult.role.toString(), "3", "Should have admin role");
            // System would redirect to /admin
        });

        it("should reject non-admin at admin login portal", async () => {
            const email = "regularuser@test.com";
            const password = "userPassword123";

            const emailHash = hashEmail(email);
            const passwordHash = hashPassword(password);

            await contract.registerUserByEmailWithRole(
                emailHash,
                passwordHash,
                1, // Regular user role
                { from: admin }
            );

            // User tries to login at /admin-login
            const loginResult = await contract.verifyCredentials(emailHash, passwordHash);

            assert.equal(loginResult.isValid, true, "Credentials are valid");
            assert.notEqual(loginResult.role.toString(), "3", "But not admin role");
            // In app.js: would show "Invalid admin credentials"
        });
    });
});
