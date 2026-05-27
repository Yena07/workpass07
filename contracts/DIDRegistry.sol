// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * DID Registry: 발행자의 DID와 공개키만 저장 (개인정보 없음)
 */
contract DIDRegistry {
    struct IssuerInfo {
        bytes pubKey;      // Ed25519 공개키 (32 bytes)
        bool registered;
        address controller; // 이 DID를 제어하는 EOA
    }

    mapping(bytes32 => IssuerInfo) private registry;

    event IssuerRegistered(bytes32 indexed didHash, address indexed controller);
    event KeyRotated(bytes32 indexed didHash, address indexed controller);

    // 발행자 DID 등록
    function registerIssuer(bytes32 didHash, bytes calldata pubKey) external {
        require(!registry[didHash].registered, "DID already registered");
        require(pubKey.length == 32, "Invalid pubKey length");
        registry[didHash] = IssuerInfo(pubKey, true, msg.sender);
        emit IssuerRegistered(didHash, msg.sender);
    }

    // 공개키 회전 (키 분실 시)
    function rotateKey(bytes32 didHash, bytes calldata newPubKey) external {
        require(registry[didHash].registered, "DID not registered");
        require(registry[didHash].controller == msg.sender, "Not controller");
        require(newPubKey.length == 32, "Invalid pubKey length");
        registry[didHash].pubKey = newPubKey;
        emit KeyRotated(didHash, msg.sender);
    }

    // 공개키 조회 (검증자가 호출)
    function resolveKey(bytes32 didHash) external view returns (bytes memory) {
        require(registry[didHash].registered, "DID not found");
        return registry[didHash].pubKey;
    }

    function isRegistered(bytes32 didHash) external view returns (bool) {
        return registry[didHash].registered;
    }
}
