"use client"

import { TriangleAlert, XIcon } from "lucide-react";

interface SettingsProps
{
    onClose(): void;
    OnSlippageSwapSettingsInputChange(value: string): void;
    OnSettingsSlippageAutoButtonClick(): void;
    inputSlippage: string;
    isSlippageAuto: boolean;
    isSlippageHigh: boolean;
    isSlippageVeryHigh: boolean;
}

function SwapSettings({onClose, OnSlippageSwapSettingsInputChange, OnSettingsSlippageAutoButtonClick, inputSlippage, isSlippageAuto, isSlippageHigh, isSlippageVeryHigh}: SettingsProps)
{
    return (
        // O pai (overlay) captura o clique e fecha o modal
        <div className="swap-modal-overlay fixed pt-45 inset-0 z-50 overflow-y-auto h-full w-full flex items-start justify-center" onClick={onClose}>

            {/* 
                O filho (conteúdo) impede que o clique se propague para o pai usando e.stopPropagation()
            */}
            <div className="swap-modal-area p-4 border w-96 shadow-lg rounded-3xl" onClick={(e) => e.stopPropagation()}>
                {/* 1. Header com relative para ancorar o botão absoluto */}
                <div className="relative flex items-center min-h-[40px] mb-4">
                    
                    {/* 2. Botão posicionado no canto superior esquerdo */}
                    <button
                        onClick={onClose}
                        className="swap-modal-close-button absolute right-0 top-1/2 -translate-y-1/2 px-2 py-2 text-base font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 transition-colors"
                    >
                        <XIcon />
                    </button>

                    {/* 3. Título */}
                    <h3 className="swap-modal-title text-base font-bold">Swap Settings</h3>
                </div>

                <div className="swap-modal-body">

                    <div className="flex flex-col gap-4">
                    
                        {/* Seção de Slippage */}
                        <div>
                            {/* Cabeçalho da Seção com Label e Info */}
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-gray-400">Max slippage</span>
                            </div>

                            {/* Layout de Opções (Auto + Input Customizado) */}
                            <div className="flex gap-2 items-center">
                            
                                {/* Botão Auto (Estilo pílula ativa) */}
                                <button 
                                    onClick={() => {OnSettingsSlippageAutoButtonClick()} }
                                    className={"swap-settings-modal-slippage-auto-button " + (isSlippageAuto ? "swap-settings-modal-slippage-auto-button-checked": "swap-settings-modal-slippage-auto-button-unchecked") + " transition-colors font-semibold py-2 px-4 rounded-xl text-sm h-10"}>
                                    
                                    Auto
                                </button>

                                {/* Container do Input Arredondado */}
                                <div className="flex-1 flex items-center justify-between bg-[#13141A] hover:bg-[#1C1E24] border border-[#22252F] focus-within:border-pink-500/50 transition-all rounded-xl h-10 px-3">
                                    <input
                                    type="text"
                                    inputMode="decimal"
                                    maxLength={5}
                                    placeholder="5.5"
                                    className="bg-transparent w-full focus:outline-none font-medium text-sm text-white placeholder-gray-600 text-right pr-1"
                                    onChange={ (event) => { OnSlippageSwapSettingsInputChange(event.target.value) } }
                                    value={inputSlippage}
                                    />
                                    
                                    {/* Label de % fixo ao lado do input */}
                                    <span className="text-sm font-semibold text-gray-400 pl-1 select-none">
                                        %
                                    </span>
                                </div>

                            </div>

                            {isSlippageHigh && (
                                <div className="swap-slippage-warning-value flex items-center gap-1 text-sm mt-2 justify-end">
                                    <TriangleAlert /> 
                                    <div>High slippage</div>
                                </div>
                            )}

                            {isSlippageVeryHigh && (
                                <div className="swap-slippage-critical-value flex items-center gap-1 text-sm mt-2 justify-end">
                                    <TriangleAlert /> 
                                    <div>Very high slippage</div>
                                </div>
                            )}

                        </div>

                    </div>

                </div>

                <div className="flex justify-center mt-4">
                </div>
            </div>
        </div>
    )
}

export default SwapSettings;