#!/bin/sh
set -e

# Liquidez NATIVO x ERC-20 na anvil local (chainId 31337).
# Uso: ./script/add-liquidity-anvil.sh [tokenAddress] [tokenAmount] [nativeAmount] [rpcUrl] [flags forge...]
#   tokenAddress  ERC-20 do par (default: .omnikronToken de deployments/31337.json)
#   tokenAmount   unidades humanas do token (default: 1)
#   nativeAmount  unidades humanas de nativo (default: 12)
#   rpcUrl        default: http://127.0.0.1:8545 (alias `anvil`)
# Ex.: ./script/add-liquidity-anvil.sh                 # 12 nativo : 1 omnikronToken
#      ./script/add-liquidity-anvil.sh "" 12 1         # 1 nativo : 12 omnikronToken
#      DRY_RUN=1 ./script/add-liquidity-anvil.sh       # apenas simula

DEPLOY_JSON="deployments/31337.json"
ANVIL_PRIVATE_KEY_DEFAULT="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" # conta #0

if [ ! -f "$DEPLOY_JSON" ]; then
  echo "deployments/31337.json nao encontrado. Rode antes: ./script/deploy-fresh.sh anvil"
  exit 1
fi

# RPC_URL=${4:-http://127.0.0.1:8545}
case "${4:-}" in
  ""|--*|-[a-zA-Z]*) RPC_URL=${RPC_URL:-http://127.0.0.1:8545} ;;
  *) RPC_URL="$4" ;;
esac

CHAIN_ID=$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)
if [ "$CHAIN_ID" != "31337" ]; then
  echo "Este script e exclusivo da anvil (chainId 31337). RPC \"$RPC_URL\" -> ${CHAIN_ID:-sem resposta}"
  echo "Suba a rede antes: anvil --load-state state.json"
  exit 1
fi

TOKEN_ADDRESS=${1:-$(jq -r '.omnikronToken' "$DEPLOY_JSON")}
TOKEN_AMOUNT=${2:-1}
NATIVE_AMOUNT=${3:-12}

TOKEN_DECIMALS=$(cast call "$TOKEN_ADDRESS" 'decimals()(uint8)' --rpc-url "$RPC_URL")
TOKEN_UNITS=$(cast to-wei "$TOKEN_AMOUNT" "$TOKEN_DECIMALS")
NATIVE_WEI=$(cast to-wei "$NATIVE_AMOUNT" ether)

PARAMS=$#
if [ "$PARAMS" -gt 4 ]; then PARAMS=4; fi
shift "$PARAMS"

echo "==> Liquidez: $NATIVE_AMOUNT nativo : $TOKEN_AMOUNT token ($TOKEN_ADDRESS, $TOKEN_DECIMALS decimals)"
echo "    rpc: $RPC_URL"

# .env aponta para a 97 (sem saldo local): sobrescreve para a conta #0 da anvil
export PRIVATE_KEY=${ANVIL_PRIVATE_KEY:-$ANVIL_PRIVATE_KEY_DEFAULT}
export LIQUIDITY_TOKEN_ADDRESS="$TOKEN_ADDRESS"
export LIQUIDITY_TOKEN="$TOKEN_UNITS"
export LIQUIDITY_NATIVE="$NATIVE_WEI"

if [ "${DRY_RUN:-0}" != "0" ]; then
  echo "==> DRY_RUN: somente simulacao"
  forge script script/AddLiquidityNative.s.sol:AddLiquidityNative --rpc-url "$RPC_URL" "$@"
else
  forge script script/AddLiquidityNative.s.sol:AddLiquidityNative --rpc-url "$RPC_URL" --broadcast "$@"

  FACTORY=$(jq -r '.factory' "$DEPLOY_JSON")
  WRAPPED=$(jq -r '.wrappedNative' "$DEPLOY_JSON")
  PAIR=$(cast call "$FACTORY" 'getPair(address,address)(address)' "$TOKEN_ADDRESS" "$WRAPPED" --rpc-url "$RPC_URL")
  echo "==> pair: $PAIR"
  cast call "$PAIR" 'getReserves()(uint112,uint112,uint32)' --rpc-url "$RPC_URL"
fi
