// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IOrderContract {
    function processRefund(uint _orderId, string memory reason) external;
}

contract ReturnRequestContract {

    enum RequestType { Return, Refund }
    enum ReturnStatus { None, Requested, Approved, Rejected }

    struct ReturnRequest {
        uint orderId;
        address buyer;
        address seller;
        RequestType requestType;
        string reason;
        ReturnStatus status;
        uint requestedAt;
        string sellerNote;
    }


    mapping(uint => ReturnRequest) private requests;
    address public orderContractAddress;
    IOrderContract private orderContract;
    function setOrderContract(address _orderContract) public {
        require(_orderContract != address(0), "Invalid address");
        orderContractAddress = _orderContract;
        orderContract = IOrderContract(_orderContract);
    }

    // allow listing requests
    uint public requestCount;
    uint[] private requestOrderIds;

    event ReturnRequested(uint indexed orderId, address indexed buyer, address indexed seller, RequestType requestType, string reason);
    event ReturnApproved(uint indexed orderId, address indexed seller, string note);
    event ReturnRejected(uint indexed orderId, address indexed seller, string note);

    function requestReturnOrRefund(
        uint _orderId,
        address _seller,
        RequestType _type,
        string memory _reason
    ) public {
        require(_orderId > 0, "Invalid orderId");
        require(_seller != address(0), "Invalid seller");
        require(bytes(_reason).length > 0, "Reason required");
        require(requests[_orderId].status == ReturnStatus.None, "Request already exists");

        requests[_orderId] = ReturnRequest({
            orderId: _orderId,
            buyer: msg.sender,
            seller: _seller,
            requestType: _type,
            reason: _reason,
            status: ReturnStatus.Requested,
            requestedAt: block.timestamp,
            sellerNote: ""
        });

        requestCount++;
        requestOrderIds.push(_orderId);

        emit ReturnRequested(_orderId, msg.sender, _seller, _type, _reason);
    }

    function approve(uint _orderId, string memory _note) public {
        ReturnRequest storage r = requests[_orderId];
        require(r.status == ReturnStatus.Requested, "No pending request");
        require(msg.sender == r.seller, "Only seller can approve");

        r.status = ReturnStatus.Approved;
        r.sellerNote = _note;

        emit ReturnApproved(_orderId, msg.sender, _note);

        // If refund, call OrderContract to process refund
        if (r.requestType == RequestType.Refund && orderContractAddress != address(0)) {
            orderContract.processRefund(_orderId, _note);
        }
    }

    function reject(uint _orderId, string memory _note) public {
        ReturnRequest storage r = requests[_orderId];
        require(r.status == ReturnStatus.Requested, "No pending request");
        require(msg.sender == r.seller, "Only seller can reject");
        require(bytes(_note).length > 0, "Rejection note required");

        r.status = ReturnStatus.Rejected;
        r.sellerNote = _note;

        emit ReturnRejected(_orderId, msg.sender, _note);
    }

    function getRequest(uint _orderId) public view returns (
        uint orderId,
        address buyer,
        address seller,
        RequestType requestType,
        string memory reason,
        ReturnStatus status,
        uint requestedAt,
        string memory sellerNote
    ) {
        ReturnRequest memory r = requests[_orderId];
        return (r.orderId, r.buyer, r.seller, r.requestType, r.reason, r.status, r.requestedAt, r.sellerNote);
    }

    function getStatus(uint _orderId) public view returns (ReturnStatus) {
        return requests[_orderId].status;
    }

    //getters for pages
    function getAllRequestOrderIds() public view returns (uint[] memory) {
        return requestOrderIds;
    }

    function getRequestOrderIdAt(uint index) public view returns (uint) {
        require(index < requestOrderIds.length, "Index out of range");
        return requestOrderIds[index];
    }
}
