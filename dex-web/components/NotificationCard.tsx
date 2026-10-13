import { CircleAlert, CircleCheck, OctagonAlert, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

export interface NotificationCardProps
{
    id: string,
    message: string,
    messageType: "success" | "error" | "info",
    duration?: number,
    onClose(): void
}

function NotificationCard({ id, message, messageType = 'success', duration = 4000, onClose }: NotificationCardProps)
{
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() =>{
        // Configura o timer para fechar automaticamente
        const timer = setTimeout(() =>{
            setIsVisible(false);
            if(onClose)
            {
                onClose();
            }
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onClose]);

    if(!isVisible)
    {
        return null;
    }

    // Define as cores com base no tipo de notificação
    const cardStyle = messageType === "success" ? "notification-success" : (messageType === "error" ? "notification-error" : "notification-info");

    return (
        <div id={id} className="fixed top-35 right-5 z-50 animate-bounce-short" role="status" aria-live="polite">
            <div className={`flex items-center max-w-sm p-4 rounded-xl border transition-all duration-300 ${cardStyle}`}>
            {/* Ícone */}
            <div className="mr-3 shrink-0">
                {messageType === 'success' && (
                    <CircleCheck />
                )}
                {messageType === 'error' && (
                    <CircleAlert />
                )}
                {messageType === 'info' && (
                    <OctagonAlert />
                )}
            </div>

            {/* Mensagem */}
            <div className="text-sm font-medium pr-4">{message}</div>

            {/* Botão de Fechar */}
            <button 
                onClick={() => { setIsVisible(false); if (onClose) onClose(); }}
                className="notification-close-button ml-auto focus:outline-none"
                aria-label="Close">

                <XIcon />

            </button>
            </div>
        </div>
    );
}

export default NotificationCard;