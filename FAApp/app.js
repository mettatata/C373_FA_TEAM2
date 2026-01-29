const express = require('express');
const {Web3} = require('web3');
const fs = require("fs");
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Load contract files
const OrderContract = require('./public/build/OrderContract.json');
const SellerOrderContract = require('./public/build/SellerOrderContract.json');
const UserRegistry = require('./public/build/UserRegistry.json');
const ReviewContract = require('./public/build/ReviewContract.json');
const ProductContract = require('./public/build/ProductContract.json');
const ReturnRequestContract = require('./public/build/ReturnRequestContract.json');

const app = express();
//Set up view engine
app.set('view engine', 'ejs');
//This line of code tells Express to serve static files
app.use(express.static('public'))
//enable form processing
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Set up multer for image uploads
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        cb(null, 'product-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Declare global variables
var GanacheWeb3;
var account = '';
// Explicit role-based accounts (Ganache): buyer: accounts[0], seller: accounts[1], admin: accounts[2]
var buyerAccount = '';
var sellerAccount = '';
var adminAccount = '';
var noOfOrders = 0;
var loading = true;  
var orderContractInfo;
var sellerContractInfo;
var userRegistryInfo;
var reviewContractInfo;
var productContractInfo;
var userCart = {}; // Store cart items with account as key
var loggedInUsers = {}; // Track logged in users
const adminSessions = new Map();
const userSessions = new Map();

// Check if user is signed in (has account connected)
function isSignedIn() {
    return account && account.trim() !== '' && !loading;
}

function isAdmin() {
    return isSignedIn();
}

function normalizeEmail(value) {
    return value.trim().toLowerCase();
}

function parseCookies(req) {
    const header = req.headers.cookie || '';
    return header.split(';').reduce((acc, pair) => {
        const [key, ...rest] = pair.trim().split('=');
        if (!key) {
            return acc;
        }
        acc[key] = decodeURIComponent(rest.join('='));
        return acc;
    }, {});
}

function getAdminSession(req) {
    const cookies = parseCookies(req);
    const token = cookies.admin_session;
    if (!token) {
        return null;
    }
    return adminSessions.get(token) || null;
}

function getUserSession(req) {
    const cookies = parseCookies(req);
    const token = cookies.user_session;
    if (!token) {
        return null;
    }
    return userSessions.get(token) || null;
}

async function verifyCredentials(email, password) {
    if (!userRegistryInfo) {
        throw new Error('User registry not available');
    }
    const emailHash = Web3.utils.keccak256(normalizeEmail(email));
    const passwordHash = Web3.utils.keccak256(password);
    const result = await userRegistryInfo.methods.verifyCredentials(emailHash, passwordHash).call();
    return { ...result, emailHash };
}

function createAdminSession(emailHash) {
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, { emailHash, createdAt: Date.now() });
    return token;
}

function createUserSession(emailHash, role) {
    const token = crypto.randomBytes(32).toString('hex');
    userSessions.set(token, { emailHash, role, createdAt: Date.now() });
    return token;
}



// Initialize blockchain on server startup
async function componentWillMount() {
    try {
        await loadWeb3();
        await loadBlockchainData();
    } catch (error) {
        console.error('Error in componentWillMount:', error);
    } 
}

// Load Web3 connection
async function loadWeb3() {
    //loads the connection to the blockchain (ganache)
    GanacheWeb3 = new Web3("http://127.0.0.1:7545");
    console.log('Web3 connected to Ganache at http://127.0.0.1:7545');
}

// Load blockchain data
async function loadBlockchainData() {
    try {
        loading = true;
        const web3 = GanacheWeb3;
        
        // Load accounts from blockchain
        const accounts = await web3.eth.getAccounts()
        // Map roles explicitly: buyer -> first address, seller -> second, admin -> last (third)
        buyerAccount = accounts[0] || '';
        sellerAccount = accounts[1] || buyerAccount || '';
        adminAccount = accounts[2] || accounts[accounts.length - 1] || buyerAccount || '';
        // Keep default account as buyer for general operations
        account = buyerAccount;
        console.log('Loaded accounts:', { buyer: buyerAccount, seller: sellerAccount, admin: adminAccount });
        
        // Get network ID
        const networkId = await web3.eth.net.getId()
        console.log('Network ID:', networkId);
        
        // Read network data for OrderContract
        const orderNetworkData = OrderContract.networks[networkId]
        if (!orderNetworkData) {
            throw new Error('Order contract not deployed to detected network');
        }
        
        // Initialize Order contract
        orderContractInfo = new web3.eth.Contract(OrderContract.abi, orderNetworkData.address)
        console.log('Order contract initialized at:', orderNetworkData.address);

        // Ensure the contract admin matches the intended admin account
        try {
            const currentAdmin = await orderContractInfo.methods.admin().call();
            if (adminAccount && currentAdmin.toLowerCase() !== adminAccount.toLowerCase()) {
                await orderContractInfo.methods.setAdmin(adminAccount).send({ from: buyerAccount || account, gas: 200000 });
                console.log('Order contract admin updated to:', adminAccount);
            }
            // Ensure payouts go to the seller wallet by setting owner to seller
            try {
                const currentOwner = await orderContractInfo.methods.owner().call();
                if (sellerAccount && currentOwner.toLowerCase() !== sellerAccount.toLowerCase()) {
                    await orderContractInfo.methods.setOwner(sellerAccount).send({ from: buyerAccount || account, gas: 200000 });
                    console.log('Order contract owner updated to seller wallet:', sellerAccount);
                }
            } catch (ownerErr) {
                console.warn('Could not set owner to seller wallet:', ownerErr?.message || ownerErr);
            }
            // Allow the designated seller account to update statuses/deliveries
            if (sellerAccount) {
                try {
                    const allowed = await orderContractInfo.methods.sellerConfirmAllowed(sellerAccount).call();
                    if (!allowed) {
                        await orderContractInfo.methods.setSellerConfirmAllowed(sellerAccount, true).send({ from: buyerAccount || account, gas: 150000 });
                        console.log('Whitelisted seller for status updates:', sellerAccount);
                    }
                } catch (allowErr) {
                    console.warn('Could not whitelist seller:', allowErr?.message || allowErr);
                }
            }
        } catch (adminErr) {
            console.warn('Could not verify/set admin on OrderContract:', adminErr?.message || adminErr);
        }
        
        // Initialize Seller contract if available
        const sellerNetworkData = SellerOrderContract.networks[networkId]
        if (sellerNetworkData) {
            sellerContractInfo = new web3.eth.Contract(SellerOrderContract.abi, sellerNetworkData.address)
            console.log('Seller contract initialized at:', sellerNetworkData.address);
        }

        // Initialize UserRegistry contract if available
        const userNetworkData = UserRegistry.networks[networkId];
        if (userNetworkData) {
            userRegistryInfo = new web3.eth.Contract(UserRegistry.abi, userNetworkData.address);
            console.log('User registry initialized at:', userNetworkData.address);
        }

        // Initialize ReviewContract if available
        const reviewNetworkData = ReviewContract.networks[networkId];
        if (reviewNetworkData) {
            reviewContractInfo = new web3.eth.Contract(ReviewContract.abi, reviewNetworkData.address);
            console.log('Review contract initialized at:', reviewNetworkData.address);
        }

        // Initialize ProductContract if available
        const productNetworkData = ProductContract.networks[networkId];
        if (productNetworkData) {
            productContractInfo = new web3.eth.Contract(ProductContract.abi, productNetworkData.address);
            console.log('Product contract initialized at:', productNetworkData.address);
        }
        
        // Get order count from contract
        const cnt = await orderContractInfo.methods.getOrderCount().call();
        noOfOrders = cnt;
        console.log(`Order count from blockchain: ${cnt.toString()}`);
        
        loading = false;
        return {
            account,
            buyerAccount,
            sellerAccount,
            adminAccount,
            orderContractInfo,
            sellerContractInfo,
            noOfOrders
        };
    } catch (error) {
        console.error('Error loading blockchain data:', error);
        loading = false;
        throw error;
    }
}

// Start server and initialize blockchain
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await componentWillMount();
});

// Helper function to check if user is logged in
function isUserLoggedIn(userAccount) {
    return loggedInUsers[userAccount] === true;
}

// Helper function to pass common data to all views
function getCommonData(req) {
    const isLoggedIn = Boolean(getUserSession(req) || getAdminSession(req));
    return {
        acct: account,
        loading: loading,
        isLoggedIn: isLoggedIn,
        error: null
    };
}

// Home page
app.get('/', async(req, res) => {   
    try {
        res.render('index', {
            acct: account,
            loading: loading,
            seller: sellerAccount
        });
    } catch (error) {
        console.error('Error in home route:', error);
        res.status(500).send('Server error');
    }
});
// Get started - redirect based on sign-in status
app.get('/get-started', (req, res) => {
    const userSession = getUserSession(req);
    if (!userSession) {
        return res.redirect('/signup');
    }
    if (String(userSession.role) === '3') {
        return res.redirect('/admin');
    }
    if (String(userSession.role) === '2') {
        return res.redirect('/seller');
    }
    return res.redirect('/user-home');
});

// Register page
app.get('/register', (req, res) => {
    try {
        res.render('register', getCommonData(req));
    } catch (error) {
        console.error('Error in register route:', error);
        res.status(500).send('Server error');
    }
});

// Sign up page
app.get('/signup', (req, res) => {
    try {
        res.render('register', getCommonData(req));
    } catch (error) {
        console.error('Error in signup route:', error);
        res.status(500).send('Server error');
    }
});

// Handle sign up submission (email + password only)
app.post('/signup', async (req, res) => {
    try {
        const email = (req.body.email || '').trim();
        const password = req.body.password || '';
        const confirmPassword = req.body.confirmPassword || '';
        const accountType = (req.body.accountType || 'user').trim().toLowerCase();

        if (!email || !password || !confirmPassword) {
            return res.status(400).render('register', {
                ...getCommonData(req),
                error: 'Email and password are required.'
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).render('register', {
                ...getCommonData(req),
                error: 'Passwords do not match.'
            });
        }

        if (!userRegistryInfo) {
            return res.status(500).render('register', {
                ...getCommonData(req),
                error: 'User registry not available.'
            });
        }

        const roleMap = { user: 1, seller: 2 };
        const role = roleMap[accountType];
        if (!role) {
            return res.status(400).render('register', {
                ...getCommonData(req),
                error: 'Please choose a valid account type.'
            });
        }

        const emailHash = Web3.utils.keccak256(normalizeEmail(email));
        const passwordHash = Web3.utils.keccak256(password);

        await userRegistryInfo.methods
            .registerUserByEmailWithRole(emailHash, passwordHash, role)
            .send({ from: account, gas: 300000 });

        return res.redirect('/login');
    } catch (error) {
        console.error('Signup error:', error);
        return res.status(500).render('register', {
            ...getCommonData(req),
            error: error.message || 'Failed to sign up.'
        });
    }
});

// Login Page 
 app.get('/login', async(req, res) => {
    try {
        res.render('login', {
            acct: account,
            loading: false,
            productData: null,
            error: null
        });
    } catch (error) {
        console.error('Error in login route:', error);
        res.status(500).send('Server error');
    }
});

// Handle login form submission (email + password only)
app.post('/login', async (req, res) => {
    try {
        const email = (req.body.email || '').trim();
        const password = req.body.password || '';

        if (!email || !password) {
            return res.status(400).render('login', {
                acct: account,
                loading: false,
                productData: null,
                error: 'Email and password are required.'
            });
        }

        const result = await verifyCredentials(email, password);
        if (!result.isValid) {
            return res.status(401).render('login', {
                acct: account,
                loading: false,
                productData: null,
                error: 'Invalid credentials.'
            });
        }

        const token = createUserSession(result.emailHash, result.role);
        res.setHeader('Set-Cookie', `user_session=${token}; HttpOnly; SameSite=Lax; Path=/`);

        if (String(result.role) === '3') {
            return res.redirect('/admin');
        }
        if (String(result.role) === '2') {
            return res.redirect('/seller');
        }
        return res.redirect('/user-home');
    } catch (error) {
        console.error('Error in login post route:', error);
        return res.status(500).render('login', {
            acct: account,
            loading: false,
            productData: null,
            error: 'Failed to login.'
        });
    }
});

// Admin login page (email + password only)
app.get('/admin-login', (req, res) => {
    res.render('admin-login', {
        error: null
    });
});

// Handle admin login submission
app.post('/admin-login', async (req, res) => {
    try {
        const email = (req.body.email || '').trim();
        const password = req.body.password || '';

        if (!email || !password) {
            return res.status(400).render('admin-login', {
                error: 'Email and password are required.'
            });
        }

        const result = await verifyCredentials(email, password);
        if (!result.isValid || String(result.role) !== '3') {
            return res.status(401).render('admin-login', {
                error: 'Invalid admin credentials.'
            });
        }

        const adminToken = createAdminSession(result.emailHash);
        const userToken = createUserSession(result.emailHash, result.role);
        res.setHeader('Set-Cookie', [
            `admin_session=${adminToken}; HttpOnly; SameSite=Lax; Path=/`,
            `user_session=${userToken}; HttpOnly; SameSite=Lax; Path=/`
        ]);
        return res.redirect('/admin');
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).render('admin-login', {
            error: 'Failed to login. Try again.'
        });
    }
});

// Admin logout
app.get('/admin-logout', (req, res) => {
    const cookies = parseCookies(req);
    if (cookies.admin_session) {
        adminSessions.delete(cookies.admin_session);
    }
    if (cookies.user_session) {
        userSessions.delete(cookies.user_session);
    }
    res.setHeader('Set-Cookie', [
        'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        'user_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
    ]);
    res.redirect('/admin-login');
});

// User home page (requires login)
app.get('/user-home', (req, res) => {
    const userSession = getUserSession(req);
    if (!userSession && !isSignedIn()) {
        return res.redirect('/login');
    }

    const role = userSession ? userSession.role : '0';
    if (String(role) === '0') {
        return res.status(403).send('Forbidden');
    }

    return res.render('user-home', getCommonData(req));
});

// Admin page (requires admin account)
app.get('/admin', (req, res) => {
    const adminSession = getAdminSession(req);
    const userSession = getUserSession(req);

    if (adminSession || (userSession && String(userSession.role) === '3')) {
        return res.render('admin', getCommonData(req));
    }

    return res.redirect('/admin-login');
});

// Promote user to admin (email + admin session)
app.post('/admin/promote', async (req, res) => {
    const adminSession = getAdminSession(req);
    const userSession = getUserSession(req);
    if (!adminSession && !(userSession && String(userSession.role) === '3')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const email = (req.body.email || '').trim();
    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
    }

    if (!userRegistryInfo) {
        return res.status(500).json({ success: false, message: 'User registry not available' });
    }

    try {
        const emailHash = Web3.utils.keccak256(normalizeEmail(email));
        await userRegistryInfo.methods
            .setAdminByEmailHash(emailHash)
            .send({ from: adminAccount || account, gas: 300000 });
        return res.json({ success: true });
    } catch (error) {
        console.error('Admin promote error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Promotion failed' });
    }
});

// Allow seller to confirm delivery
app.post('/admin/allow-seller', async (req, res) => {
    const adminSession = getAdminSession(req);
    const userSession = getUserSession(req);
    if (!adminSession && !(userSession && String(userSession.role) === '3')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const sellerAddress = (req.body.sellerAddress || '').trim();
    if (!sellerAddress) {
        return res.status(400).json({ success: false, message: 'Seller address is required' });
    }

    if (!orderContractInfo) {
        return res.status(500).json({ success: false, message: 'Order contract not available' });
    }

    try {
        // setSellerConfirmAllowed is owner-only; owner is the deployer (first Ganache account / buyerAccount)
        await orderContractInfo.methods
            .setSellerConfirmAllowed(sellerAddress, true)
            .send({ from: buyerAccount || account, gas: 200000 });
        return res.json({ success: true });
    } catch (error) {
        console.error('Allow seller error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to allow seller' });
    }
});

// Admin validates delivery (after buyer confirmation) and releases funds
app.post('/admin/validate-delivery', async (req, res) => {
    const adminSession = getAdminSession(req);
    const userSession = getUserSession(req);
    if (!adminSession && !(userSession && String(userSession.role) === '3')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const orderId = Number(req.body.orderId || 0);
    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    if (!orderContractInfo) {
        return res.status(500).json({ success: false, message: 'Order contract not available' });
    }

    try {
        console.log('Admin validating order', orderId, 'from admin account:', adminAccount);
        
        // Check order status before sending
        try {
            const order = await orderContractInfo.methods.getOrder(orderId).call();
            console.log('Order status before validation:', {
                status: order.status,
                isPaid: order.isPaid,
                isReleased: order.isReleased,
                buyer: order.buyer,
                seller: order.seller,
                totalAmount: order.totalAmount
            });
        } catch (checkErr) {
            console.error('Could not fetch order details:', checkErr.message);
        }
        
        await orderContractInfo.methods
            .adminValidateDelivery(orderId)
            .send({ from: adminAccount || account, gas: 300000 });

        return res.json({ success: true });
    } catch (error) {
        console.error('Admin validate delivery error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Validation failed' });
    }
});

// List users for admin dashboard
app.get('/admin/users', async (req, res) => {
    const adminSession = getAdminSession(req);
    const userSession = getUserSession(req);
    if (!adminSession && !(userSession && String(userSession.role) === '3')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!userRegistryInfo) {
        return res.status(500).json({ success: false, message: 'User registry not available' });
    }

    try {
        const count = await userRegistryInfo.methods.getUserCount().call();
        const total = Number(count);
        const limit = Math.min(total, 200);
        const users = [];
        for (let i = 0; i < limit; i++) {
            const user = await userRegistryInfo.methods.getUserByIndex(i).call();
            users.push({
                emailHash: user.emailHash,
                role: String(user.role),
                wallet: user.wallet
            });
        }

        return res.json({ success: true, users });
    } catch (error) {
        console.error('Admin users error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to load users' });
    }
});


// Handle logout
app.post('/logout', express.json(), async(req, res) => {
    try {
        const cookies = parseCookies(req);
        if (cookies.user_session) {
            userSessions.delete(cookies.user_session);
        }
        if (cookies.admin_session) {
            adminSessions.delete(cookies.admin_session);
        }
        console.log('User logged out');
        
        res.json({
            success: true,
            message: 'Logged out successfully',
            isLoggedIn: false
        });
    } catch (error) {
        console.error('Error in logout route:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Product page
app.get('/products', async(req, res) => {
    try {
        const data = getCommonData(req);
        res.render('products', {
            ...data,
            seller: sellerAccount
        });
    } catch (error) {
        console.error('Error in products route:', error);
        res.status(500).send('Server error');
    }
});

// Buy page - Order Summary
app.get('/buy', async(req, res) => {
    try {
        const data = getCommonData(req);
        res.render('buy', {
            ...data,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract)
        });
    } catch (error) {
        console.error('Error in buy route:', error);
        res.status(500).send('Server error');
    }
});

// Order Tracker
app.get('/ordertrack', async(req, res) => {
    try {
        const orderId = req.query.orderId || '';
        const data = getCommonData(req);
        res.render('ordertrack', {
            ...data,
            orderId: orderId,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract)
        });
    } catch (error) {
        console.error('Error in ordertrack route:', error);
        res.status(500).send('Server error');
    }
});

// Order Details (with path parameter)
app.get('/orderdetails/:orderId', async(req, res) => {
    try {
        const data = getCommonData(req);
        res.render('orderdetails', {
            ...data,
            orderId: req.params.orderId,
            seller: sellerAccount,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract)
        });
    } catch (error) {
        console.error('Error in orderdetails route:', error);
        res.status(500).send('Server error');
    }
});

// Order Details (with query parameter)
app.get('/orderdetails', async(req, res) => {
    const orderId = req.query.orderId || '';
    const data = getCommonData(req);
    
    try {
        res.render('orderdetails', {
            ...data,
            orderId: orderId,
            seller: sellerAccount,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract)
        });
    } catch (error) {
        console.error('Error in orderdetails route:', error);
        res.status(500).send('Server error');
    }
});

app.get('/orderhistory', async(req, res) => {
    const data = getCommonData(req);
    
    try {
        res.render('orderhistory', {
            ...data,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract),
            sellerContractABI: JSON.stringify(SellerOrderContract.abi),
            sellerContractData: JSON.stringify(SellerOrderContract)
        });
    } catch (error) {
        console.error('Error in orderhistory route:', error);
        res.status(500).send('Server error');
    }
});

app.get('/buyerorders', async(req, res) => {
    const data = getCommonData(req);
    try {
        res.render('buyerorders', {
            ...data,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract)
        });
    } catch (error) {
        console.error('Error in buyerorders route:', error);
        res.status(500).send('Server error');
    }
});

app.get('/sellerorders', async(req, res) => {
    const data = getCommonData(req);
    
    try {
        // Resolve seller contract address with live instance fallback
        const artifactNetworks = SellerOrderContract.networks || {};
        const artifactAddr = (artifactNetworks['5777'] && artifactNetworks['5777'].address)
            || (artifactNetworks['1337'] && artifactNetworks['1337'].address);
        const sellerContractAddress = (sellerContractInfo && sellerContractInfo.options && sellerContractInfo.options.address)
            || artifactAddr || 'Not deployed';

        res.render('sellerorders', {
            ...data,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract),
            sellerContractABI: JSON.stringify(SellerOrderContract.abi),
            sellerContractData: JSON.stringify(SellerOrderContract),
            sellerContractAddress: sellerContractAddress
        });
    } catch (error) {
        console.error('Error in sellerorders route:', error);
        res.status(500).send('Server error');
    }
});

// Seller products page
app.get('/sellerproducts', async(req, res) => {
    const data = getCommonData(req);
    try {
        // Prefer live contract address; fallback to artifact networks
        const artifactNetworks = SellerOrderContract.networks || {};
        const artifactAddr = (artifactNetworks['5777'] && artifactNetworks['5777'].address)
            || (artifactNetworks['1337'] && artifactNetworks['1337'].address);
        const sellerContractAddress = (sellerContractInfo && sellerContractInfo.options && sellerContractInfo.options.address)
            || artifactAddr || 'Not deployed';
        res.render('sellerproducts', {
            ...data,
            sellerContractAddress: sellerContractAddress,
            sellerContractABI: JSON.stringify(SellerOrderContract.abi),
            sellerContractData: JSON.stringify(SellerOrderContract)
        });
    } catch (error) {
        console.error('Error in sellerproducts route:', error);
        res.status(500).send('Server error');
    }
});

// Handle MetaMask connection
app.post('/web3ConnectData', express.json(), async (req, res) => {
    try {
        const { contractAddress, acct, orderCnt } = req.body;
        account = acct;
        orderCount = orderCnt;
        loading = false;
        
        console.log('Connected account:', account);
        console.log('Contract address:', contractAddress);
        
        res.json({
            success: true,
            message: 'Connected successfully'
        });
    } catch (error) {
        console.error('Error in web3ConnectData:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Create order
app.post('/createOrder', express.json(), async (req, res) => {
    try {
        const { orderId, txHash } = req.body;
        
        console.log('Order created:', orderId);
        console.log('Transaction hash:', txHash);
        
        res.json({
            success: true,
            orderId: orderId,
            txHash: txHash
        });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Confirm delivery page
app.get('/confirm', async(req, res) => {
    const orderId = req.query.orderId || '';
    const data = getCommonData(req);
    
    try {
        res.render('confirm', {
            ...data,
            orderId: orderId,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract)
        });
    } catch (error) {
        console.error('Error in confirm route:', error);
        res.status(500).send('Server error');
    }
});

// Handle delivery confirmation
app.post('/confirmDelivery', express.json(), async (req, res) => {
    try {
        const { orderId, received, txHash } = req.body;
        
        console.log('Delivery confirmation:', orderId, received);
        console.log('Transaction hash:', txHash);
        
        res.json({
            success: true,
            message: received ? 'Delivery confirmed' : 'Refund requested'
        });
    } catch (error) {
        console.error('Error confirming delivery:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get order data (for AJAX calls)

// Add to cart
app.post('/addToCart', express.json(), async (req, res) => {
    try {
        const { productName, price, userAccount } = req.body;
        
        console.log('=== ADD TO CART DEBUG ===');
        console.log('Adding for account:', userAccount);
        console.log('Product:', productName, 'Price:', price);
        
        // Initialize cart for user if not exists
        if (!userCart[userAccount]) {
            userCart[userAccount] = [];
        }
        
        // Add item to cart
        const cartItem = {
            id: Date.now(),
            productName: productName,
            price: parseFloat(price),
            quantity: 1
        };
        userCart[userAccount].push(cartItem);
        
        console.log('Cart after add:', userCart[userAccount]);
        console.log('All cart keys:', Object.keys(userCart));
        console.log('=======================');
        
        res.json({
            success: true,
            message: 'Item added to cart',
            cartCount: userCart[userAccount].length
        });
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// View cart
app.get('/cart', async (req, res) => {
    try {
        const data = getCommonData(req);
        res.render('cart', {
            ...data,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract)
        });
    } catch (error) {
        console.error('Error in cart route:', error);
        res.status(500).send('Server error');
    }
});

// Get cart items
app.get('/getCart', express.json(), async (req, res) => {
    try {
        const userAccount = req.query.account;
        const cartItems = userCart[userAccount] || [];
        
        console.log('=== GET CART DEBUG ===');
        console.log('Requested account:', userAccount);
        console.log('All cart keys:', Object.keys(userCart));
        console.log('Cart items for this account:', cartItems);
        console.log('====================');
        
        res.json({
            success: true,
            items: cartItems,
            total: cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0)
        });
    } catch (error) {
        console.error('Error getting cart:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Remove from cart
app.post('/removeFromCart', express.json(), async (req, res) => {
    try {
        const { itemId, userAccount } = req.body;
        
        if (!userCart[userAccount]) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }
        
        // Remove item by id
        userCart[userAccount] = userCart[userAccount].filter(item => item.id !== itemId);
        
        console.log('Item removed from cart. Remaining items:', userCart[userAccount].length);
        
        res.json({
            success: true,
            message: 'Item removed from cart',
            cartCount: userCart[userAccount].length
        });
    } catch (error) {
        console.error('Error removing from cart:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Checkout page
app.get('/checkout', async (req, res) => {
    try {
        const data = getCommonData(req);
        res.render('checkout', {
            ...data,
            contractABI: JSON.stringify(OrderContract.abi),
            contractData: JSON.stringify(OrderContract)
        });
    } catch (error) {
        console.error('Error in checkout route:', error);
        res.status(500).send('Server error');
    }
});

// Process checkout
app.post('/processCheckout', express.json(), async (req, res) => {
    try {
        const { userAccount, name, email, address, cartItems } = req.body;
        
        console.log('Checkout data:', { userAccount, name, email, address, cartItems });
        
        // Store customer info (this would be done in smart contract in production)
        const checkoutData = {
            userAccount,
            name,
            email,
            address,
            items: cartItems,
            timestamp: new Date(),
            total: cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0)
        };
        
        // Clear cart after checkout
        if (userCart[userAccount]) {
            delete userCart[userAccount];
        }
        
        res.json({
            success: true,
            message: 'Checkout completed successfully',
            checkoutData: checkoutData
        });
    } catch (error) {
        console.error('Error processing checkout:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Seller side page
app.get('/seller', async(req, res) => {
    try {
        const userSession = getUserSession(req);
        if (!userSession || String(userSession.role) !== '2') {
            return res.redirect('/login');
        }

        // Prefer live contract address; fallback to artifact networks
        const artifactNetworks = SellerOrderContract.networks || {};
        const artifactAddr = (artifactNetworks['5777'] && artifactNetworks['5777'].address)
            || (artifactNetworks['1337'] && artifactNetworks['1337'].address);
        const sellerContractAddress = (sellerContractInfo && sellerContractInfo.options && sellerContractInfo.options.address)
            || artifactAddr || 'Not deployed';
        const data = getCommonData(req);
        res.render('seller', {
            ...data,
            orderId: 0,
            sellerContractAddress: sellerContractAddress,
            orderContractABI: JSON.stringify(OrderContract.abi),
            orderContractData: JSON.stringify(OrderContract),
            sellerContractABI: JSON.stringify(SellerOrderContract.abi),
            sellerContractData: JSON.stringify(SellerOrderContract)
        });
    } catch (error) {
        console.error('Error in seller route:', error);
        res.status(500).send('Server error');
    }
});

// Create seller profile
app.post('/createSellerProfile', express.json(), async (req, res) => {
    try {
        const { sellerName, txHash } = req.body;
        
        console.log('Seller profile created:', sellerName);
        console.log('Transaction hash:', txHash);
        
        res.json({
            success: true,
            message: 'Seller profile created successfully',
            sellerName: sellerName
        });
    } catch (error) {
        console.error('Error creating seller profile:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Accept order
app.post('/acceptOrder', express.json(), async (req, res) => {
    try {
        const { orderId, txHash } = req.body;
        
        console.log('Order accepted:', orderId);
        console.log('Transaction hash:', txHash);
        
        res.json({
            success: true,
            message: 'Order accepted successfully',
            orderId: orderId
        });
    } catch (error) {
        console.error('Error accepting order:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Ship order
app.post('/shipOrder', express.json(), async (req, res) => {
    try {
        const { orderId, trackingNumber, txHash } = req.body;
        
        console.log('Order shipped:', orderId);
        console.log('Tracking number:', trackingNumber);
        console.log('Transaction hash:', txHash);
        
        // Update the tracking number in the smart contract
        if (orderContractInfo && trackingNumber) {
            try {
                const tx = await orderContractInfo.methods.updateTrackingNumber(orderId, trackingNumber)
                    .send({ from: account, gas: 500000 });
                console.log('Tracking number updated in contract:', tx);
            } catch (contractError) {
                console.warn('Could not update tracking number in contract:', contractError.message);
                // Continue anyway, tracking was likely updated on seller contract side
            }
        }
        
        res.json({
            success: true,
            message: 'Order shipped successfully',
            orderId: orderId,
            trackingNumber: trackingNumber
        });
    } catch (error) {
        console.error('Error shipping order:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Release payment to seller
app.post('/releasePayment', express.json(), async (req, res) => {
    try {
        const { orderId, txHash } = req.body;
        
        console.log('Payment released:', orderId);
        console.log('Transaction hash:', txHash);
        
        res.json({
            success: true,
            message: 'Payment released successfully',
            orderId: orderId
        });
    } catch (error) {
        console.error('Error releasing payment:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get tracking info for seller order
app.get('/getSellerTrackingInfo', express.json(), async (req, res) => {
    try {
        const orderId = req.query.orderId;
        
        if (!orderId || !sellerContractInfo) {
            return res.status(400).json({
                success: false,
                message: 'Order ID required or contract not available'
            });
        }
        
        // Call contract method to get tracking info
        const trackingInfo = await sellerContractInfo.methods.getTrackingInfo(orderId).call({
            from: account
        });
        
        res.json({
            success: true,
            status: trackingInfo.status,
            trackingNumber: trackingInfo.trackingNumber,
            timestamp: trackingInfo.timestamp
        });
    } catch (error) {
        console.error('Error getting seller tracking info:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get tracking history for order
app.get('/getTrackingHistory', express.json(), async (req, res) => {
    try {
        const orderId = req.query.orderId;
        
        if (!orderId || !orderContractInfo) {
            return res.status(400).json({
                success: false,
                message: 'Order ID required or contract not available'
            });
        }
        
        // Call contract method to get tracking history
        const trackingHistory = await orderContractInfo.methods.getTrackingHistory(orderId).call({
            from: account
        });
        
        res.json({
            success: true,
            trackingHistory: trackingHistory
        });
    } catch (error) {
        console.error('Error getting tracking history:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get tracking number - accessible by both seller and buyer
app.get('/getTrackingNumber', express.json(), async (req, res) => {
    try {
        const orderId = req.query.orderId;
        
        if (!orderId) {
            return res.status(400).json({
                success: false,
                trackingNumber: "",
                message: 'Order ID required'
            });
        }
        
        if (!orderContractInfo) {
            return res.status(400).json({
                success: false,
                trackingNumber: "",
                message: 'Order contract not available'
            });
        }
        
        try {
            // Call contract method to get tracking number from OrderContract
            const trackingNumber = await orderContractInfo.methods.getTrackingNumber(orderId).call({
                from: account
            });
            
            console.log('Tracking number retrieved for order', orderId, ':', trackingNumber);
            
            res.json({
                success: true,
                trackingNumber: trackingNumber || ""
            });
        } catch (contractError) {
            console.error('Contract call error:', contractError.message);
            
            // Return empty tracking number if order doesn't exist or not shipped yet
            res.json({
                success: false,
                trackingNumber: "",
                message: contractError.message || 'Tracking number not available'
            });
        }
    } catch (error) {
        console.error('Error getting tracking number:', error);
        res.status(500).json({
            success: false,
            trackingNumber: "",
            message: error.message || 'Could not retrieve tracking number'
        });
    }
});

// Update tracking number for an order
app.post('/updateTrackingNumber', express.json(), async (req, res) => {
    try {
        const { orderId, trackingNumber } = req.body;
        
        if (!orderId || !trackingNumber) {
            return res.status(400).json({
                success: false,
                message: 'Order ID and tracking number required'
            });
        }
        
        if (!orderContractInfo) {
            return res.status(400).json({
                success: false,
                message: 'Order contract not available'
            });
        }
        
        console.log('Updating tracking number for order:', orderId, 'Tracking:', trackingNumber);
        
        // Call contract method to update tracking number
        const tx = await orderContractInfo.methods.updateTrackingNumber(orderId, trackingNumber)
            .send({ from: account, gas: 500000 });
        
        console.log('Tracking number updated:', tx);
        
        res.json({
            success: true,
            message: 'Tracking number updated successfully',
            orderId: orderId,
            trackingNumber: trackingNumber,
            txHash: tx.transactionHash
        });
    } catch (error) {
        console.error('Error updating tracking number:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get full tracking info from OrderContract - accessible by both buyer and seller
app.get('/getFullTrackingInfo', express.json(), async (req, res) => {
    try {
        const orderId = req.query.orderId;
        
        if (!orderId || !orderContractInfo) {
            return res.status(400).json({
                success: false,
                message: 'Order ID required or contract not available'
            });
        }
        
        // Call contract method to get full tracking info
        const trackingInfo = await orderContractInfo.methods.getFullTrackingInfo(orderId).call({
            from: account
        });
        
        res.json({
            success: true,
            orderId: trackingInfo.orderId,
            productName: trackingInfo.productName,
            currentStatus: trackingInfo.currentStatus,
            history: trackingInfo.history
        });
    } catch (error) {
        console.error('Error getting full tracking info:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Only buyer or seller can view tracking information'
        });
    }
});

// ========== REVIEW SYSTEM ROUTES ==========

// GET: Fetch order data for review modal
app.get('/getOrderData', async (req, res) => {
    try {
        if (!orderContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Order contract not available'
            });
        }

        const orderId = req.query.orderId;
        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID is required'
            });
        }

        const order = await orderContractInfo.methods.getOrder(orderId).call();
        
        res.json({
            success: true,
            orderId: orderId,
            product: order.productName,
            productId: order.productId,
            seller: order.seller,
            buyer: order.buyer,
            status: order.status
        });
    } catch (error) {
        console.error('Error getting order data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get order data'
        });
    }
});

// POST: Submit a review for a completed order
app.post('/submitReview', express.json(), async (req, res) => {
    try {
        if (!reviewContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Review contract not available'
            });
        }

        const { orderId, seller, productId, productName, stars, comment } = req.body;
        const buyer = account;

        // Validate inputs - productId can be 0 for orders without productId
        if (!orderId || !seller || productId === undefined || productId === null || !productName || !stars) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: orderId, seller, productName, and stars are required'
            });
        }

        if (stars < 1 || stars > 5) {
            return res.status(400).json({
                success: false,
                message: 'Stars must be between 1 and 5'
            });
        }

        // Check if order is already reviewed
        const isReviewed = await reviewContractInfo.methods.isOrderReviewed(orderId).call();
        if (isReviewed) {
            return res.status(400).json({
                success: false,
                message: 'This order has already been reviewed'
            });
        }

        // Submit review to smart contract
        const tx = await reviewContractInfo.methods.submitReview(
            orderId,
            seller,
            productId,
            productName,
            stars,
            comment || ''
        ).send({ from: buyer, gas: 500000 });

        res.json({
            success: true,
            message: 'Review submitted successfully',
            transactionHash: tx.transactionHash,
            reviewId: tx.events?.ReviewSubmitted?.returnValues?.reviewId
        });
    } catch (error) {
        console.error('Error submitting review:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to submit review'
        });
    }
});

// POST: Edit an existing review
app.post('/editReview', express.json(), async (req, res) => {
    try {
        if (!reviewContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Review contract not available'
            });
        }

        const { reviewId, stars, comment } = req.body;
        const buyer = account;

        // Validate inputs
        if (reviewId === undefined || !stars) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        if (stars < 1 || stars > 5) {
            return res.status(400).json({
                success: false,
                message: 'Stars must be between 1 and 5'
            });
        }

        // Check if buyer can edit this review
        const canEdit = await reviewContractInfo.methods.canEditReview(reviewId, buyer).call();
        if (!canEdit) {
            return res.status(403).json({
                success: false,
                message: 'You can only edit your own reviews'
            });
        }

        // Edit review in smart contract
        const tx = await reviewContractInfo.methods.editReview(
            reviewId,
            stars,
            comment || ''
        ).send({ from: buyer, gas: 500000 });

        res.json({
            success: true,
            message: 'Review updated successfully',
            transactionHash: tx.transactionHash
        });
    } catch (error) {
        console.error('Error editing review:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to edit review'
        });
    }
});

// GET: Get seller reputation/rating
app.get('/getSellerReputation/:sellerAddress', async (req, res) => {
    try {
        if (!reviewContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Review contract not available'
            });
        }

        const sellerAddress = req.params.sellerAddress;
        const reputation = await reviewContractInfo.methods.getSellerReputation(sellerAddress).call();

        // Convert averageRating from contract (stored as rating * 100)
        const averageRating = parseInt(reputation.averageRating) / 100;

        res.json({
            success: true,
            seller: sellerAddress,
            totalReviews: parseInt(reputation.totalReviews),
            totalStars: parseInt(reputation.totalStars),
            averageRating: averageRating.toFixed(2)
        });
    } catch (error) {
        console.error('Error getting seller reputation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get seller reputation'
        });
    }
});

// GET: Get all reviews for a seller
app.get('/getSellerReviews/:sellerAddress', async (req, res) => {
    try {
        if (!reviewContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Review contract not available'
            });
        }

        const sellerAddress = req.params.sellerAddress;
        const reviewIds = await reviewContractInfo.methods.getSellerReviews(sellerAddress).call();
        
        const reviews = [];
        for (let i = 0; i < reviewIds.length; i++) {
            const review = await reviewContractInfo.methods.getReview(reviewIds[i]).call();
            reviews.push({
                reviewId: review.reviewId,
                orderId: review.orderId,
                buyer: review.buyer,
                stars: parseInt(review.stars),
                comment: review.comment,
                productName: review.productName,
                edited: review.edited,
                timestamp: new Date(parseInt(review.timestamp) * 1000).toLocaleDateString()
            });
        }

        res.json({
            success: true,
            reviews: reviews,
            totalReviews: reviews.length
        });
    } catch (error) {
        console.error('Error getting seller reviews:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get seller reviews'
        });
    }
});

// GET: Check if order can be reviewed (must be delivered)
app.get('/canReviewOrder/:orderId', async (req, res) => {
    try {
        if (!orderContractInfo || !reviewContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Contracts not available'
            });
        }

        const orderId = req.params.orderId;
        
        // Check order status
        const order = await orderContractInfo.methods.getOrder(orderId).call();
        // Allow reviews on status 3 (Delivered) or status 4 (Confirmed/Order Received)
        const isDelivered = order.status == 3 || order.status == 4;
        
        // Check if already reviewed
        const isReviewed = await reviewContractInfo.methods.isOrderReviewed(orderId).call();

        res.json({
            success: true,
            orderId: orderId,
            canReview: isDelivered && !isReviewed,
            isDelivered: isDelivered,
            isReviewed: isReviewed,
            statusMessage: !isDelivered ? 'Order not yet delivered' : isReviewed ? 'Order already reviewed' : 'Ready for review'
        });
    } catch (error) {
        console.error('Error checking review eligibility:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check review eligibility'
        });
    }
});

// GET: Get existing review for an order (for editing)
app.get('/getOrderReview/:orderId', async (req, res) => {
    try {
        if (!reviewContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Review contract not available'
            });
        }

        const orderId = req.params.orderId;
        const reviewId = await reviewContractInfo.methods.getOrderReviewId(orderId).call();
        
        if (reviewId === '0') {
            return res.status(404).json({
                success: false,
                message: 'No review found for this order'
            });
        }

        const review = await reviewContractInfo.methods.getReview(reviewId).call();
        
        res.json({
            success: true,
            reviewId: review.reviewId,
            stars: parseInt(review.stars),
            comment: review.comment,
            edited: review.edited,
            timestamp: new Date(parseInt(review.timestamp) * 1000).toLocaleDateString()
        });
    } catch (error) {
        console.error('Error getting order review:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get review'
        });
    }
});

// GET: Seller profile with reputation and reviews
app.get('/sellerprofile/:sellerAddress', async (req, res) => {
    try {
        if (!reviewContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Review contract not available'
            });
        }

        const sellerAddress = req.params.sellerAddress;
        const reputation = await reviewContractInfo.methods.getSellerReputation(sellerAddress).call();
        
        const reviewIds = await reviewContractInfo.methods.getSellerReviews(sellerAddress).call();
        const reviews = [];
        
        for (let i = 0; i < Math.min(reviewIds.length, 50); i++) {
            const review = await reviewContractInfo.methods.getReview(reviewIds[i]).call();
            reviews.push({
                reviewId: review.reviewId,
                orderId: review.orderId,
                buyer: review.buyer,
                stars: parseInt(review.stars),
                comment: review.comment,
                productName: review.productName,
                edited: review.edited,
                timestamp: new Date(parseInt(review.timestamp) * 1000).toLocaleDateString()
            });
        }

        const averageRating = parseInt(reputation.averageRating) / 100;

        res.render('sellerprofile', {
            seller: sellerAddress,
            averageRating: averageRating.toFixed(2),
            totalReviews: parseInt(reputation.totalReviews),
            reviews: reviews.reverse() // Show newest first
        });
    } catch (error) {
        console.error('Error loading seller profile:', error);
        res.status(500).render('error', {
            message: 'Failed to load seller profile'
        });
    }
});
// ==================== PRODUCT ROUTES ====================

// Get all active products
app.get('/getProducts', async (req, res) => {
    try {
        if (!productContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Product contract not available'
            });
        }

        const products = await productContractInfo.methods.getAllProducts().call();
        
        const formattedProducts = products.map(product => ({
            productId: parseInt(product.productId),
            seller: product.seller,
            name: product.name,
            price: parseInt(product.price),
            description: product.description,
            imageUrl: product.imageUrl,
            timestamp: new Date(parseInt(product.timestamp) * 1000).toLocaleDateString(),
            active: product.active
        }));

        res.json({
            success: true,
            products: formattedProducts
        });
    } catch (error) {
        console.error('Error getting products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get products'
        });
    }
});

// Get single product
app.get('/getProduct/:productId', async (req, res) => {
    try {
        if (!productContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Product contract not available'
            });
        }

        const productId = req.params.productId;
        const product = await productContractInfo.methods.getProduct(productId).call();

        res.json({
            success: true,
            product: {
                productId: parseInt(product.productId),
                seller: product.seller,
                name: product.name,
                price: parseInt(product.price),
                description: product.description,
                imageUrl: product.imageUrl,
                timestamp: new Date(parseInt(product.timestamp) * 1000).toLocaleDateString(),
                active: product.active
            }
        });
    } catch (error) {
        console.error('Error getting product:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get product'
        });
    }
});

// Get seller's products
app.get('/getSellerProducts/:sellerAddress', async (req, res) => {
    try {
        if (!productContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Product contract not available'
            });
        }

        const sellerAddress = req.params.sellerAddress;
        const products = await productContractInfo.methods.getSellerActiveProducts(sellerAddress).call();

        const formattedProducts = products.map(product => ({
            productId: parseInt(product.productId),
            seller: product.seller,
            name: product.name,
            price: parseInt(product.price),
            description: product.description,
            imageUrl: product.imageUrl,
            timestamp: new Date(parseInt(product.timestamp) * 1000).toLocaleDateString(),
            active: product.active
        }));

        res.json({
            success: true,
            products: formattedProducts
        });
    } catch (error) {
        console.error('Error getting seller products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get seller products'
        });
    }
});

// Add new product (seller only)
app.post('/addProduct', upload.single('productImage'), async (req, res) => {
    try {
        if (!productContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Product contract not available'
            });
        }

        const { name, price, description, sellerAddress } = req.body;
        let imageUrl = '';
        
        // If image uploaded, set the image URL
        if (req.file) {
            imageUrl = '/uploads/' + req.file.filename;
        }
        
        // Use the seller address from the request, or fall back to the current account
        const seller = sellerAddress || account;

        // Validate inputs
        if (!name || !price || !description) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        console.log(`Adding product "${name}" for seller: ${seller}`);

        // Add product to contract
        const tx = await productContractInfo.methods.addProduct(
            name,
            parseInt(price),
            description,
            imageUrl
        ).send({ from: seller, gas: 500000 });

        const productIdFromEvent = tx.events?.ProductAdded?.returnValues?.productId;
        const productIdStr = String(productIdFromEvent);
        
        console.log(`✓ Product "${name}" added with ID: ${productIdStr}`);

        res.json({
            success: true,
            message: 'Product added successfully',
            transactionHash: tx.transactionHash,
            productId: productIdStr
        });
    } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to add product'
        });
    }
});

// Update product
app.post('/updateProduct', upload.single('productImage'), async (req, res) => {
    try {
        if (!productContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Product contract not available'
            });
        }

        const { productId, name, price, description, sellerAddress } = req.body;
        let imageUrl = '';
        
        // If image uploaded, set the image URL
        if (req.file) {
            imageUrl = '/uploads/' + req.file.filename;
        }
        
        // Use the seller address from the request, or fall back to the current account
        const seller = sellerAddress || account;

        // Validate inputs
        if (!productId || !name || !price || !description) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        console.log(`Updating product "${name}" (ID: ${productId}) for seller: ${seller}`);

        // Update product
        const tx = await productContractInfo.methods.updateProduct(
            parseInt(productId),
            name,
            parseInt(price),
            description,
            imageUrl || ''
        ).send({ from: seller, gas: 500000 });

        res.json({
            success: true,
            message: 'Product updated successfully',
            transactionHash: tx.transactionHash,
            productId: productId
        });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update product'
        });
    }
});

// Deactivate product
app.post('/deactivateProduct', express.json(), async (req, res) => {
    try {
        if (!productContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Product contract not available'
            });
        }

        const { productId, sellerAddress } = req.body;
        const seller = sellerAddress || account;

        console.log(`Deactivating product ID: ${productId} for seller: ${seller}`);

        // Deactivate product
        const tx = await productContractInfo.methods.deactivateProduct(
            parseInt(productId)
        ).send({ from: seller, gas: 500000 });

        res.json({
            success: true,
            message: 'Product deactivated successfully',
            transactionHash: tx.transactionHash
        });
    } catch (error) {
        console.error('Error deactivating product:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to deactivate product'
        });
    }
});

// Initialize default products
app.post('/initializeDefaultProducts', express.json(), async (req, res) => {
    try {
        if (!productContractInfo) {
            return res.status(500).json({
                success: false,
                message: 'Product contract not available'
            });
        }

        // Use seller account (accounts[1]) instead of current user account
        const seller = sellerAccount;
        console.log(`Initializing products for seller: ${seller}`);
        
        const defaultProducts = [
            {
                name: 'One Piece The Monsters',
                price: 150,
                description: 'Collectible anime merchandise. Grade A+++ condition. Comes with official box.',
                imageUrl: '/images/onepiece.jpg'
            },
            {
                name: 'Gaming Headset Pro',
                price: 85,
                description: 'Professional gaming headset with 7.1 surround sound, noise cancelling microphone. RGB lighting included.',
                imageUrl: ''
            },
            {
                name: 'Blue Sneakers',
                price: 120,
                description: 'Premium blue sneakers, limited edition design. Size 9-12 available. Brand new condition.',
                imageUrl: ''
            }
        ];

        const addedProducts = [];

        // Add each product to the blockchain
        for (const product of defaultProducts) {
            try {
                const tx = await productContractInfo.methods.addProduct(
                    product.name,
                    parseInt(product.price),
                    product.description,
                    product.imageUrl || ''
                ).send({ from: seller, gas: 500000 });

                // Get productId from the event return values
                const productIdFromEvent = tx.events?.ProductAdded?.returnValues?.productId;
                const productIdStr = String(productIdFromEvent);
                
                console.log(`✓ Product added: "${product.name}" with ID: ${productIdStr}`);

                addedProducts.push({
                    name: product.name,
                    transactionHash: tx.transactionHash,
                    productId: productIdStr
                });
            } catch (error) {
                console.error(`Error adding product ${product.name}:`, error);
                addedProducts.push({
                    name: product.name,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: 'Default products initialization completed',
            products: addedProducts
        });
    } catch (error) {
        console.error('Error initializing default products:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to initialize products'
        });
    }
});

app.get('/returnbuyer', async (req, res) => {
    const data = getCommonData(req);

    try {
        res.render('returnbuyer', {
            ...data,
            orderContractABI: JSON.stringify(OrderContract.abi),
            orderContractData: JSON.stringify(OrderContract),
            returnContractABI: JSON.stringify(ReturnRequestContract.abi),
            returnContractData: JSON.stringify(ReturnRequestContract)
        });
    } catch (error) {
        console.error('Error in returnbuyer route:', error);
        res.status(500).send('Server error');
    }
});

app.get('/returnseller', async (req, res) => {
    const data = getCommonData(req);

    try {
        res.render('returnseller', {
            ...data,
            orderContractABI: JSON.stringify(OrderContract.abi),
            orderContractData: JSON.stringify(OrderContract),
            returnContractABI: JSON.stringify(ReturnRequestContract.abi),
            returnContractData: JSON.stringify(ReturnRequestContract)
        });
    } catch (error) {
        console.error('Error in returnseller route:', error);
        res.status(500).send('Server error');
    }
});