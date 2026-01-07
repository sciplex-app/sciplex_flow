import { useToastStore } from '../store/toastStore';
import { ToastType } from '../components/Toast';

export function useToast() {
  const showToast = useToastStore((s) => s.showToast);

  return {
    showToast: (message: string, type?: ToastType, duration?: number) => {
      showToast(message, type, duration);
    },
    success: (message: string, duration?: number) => {
      showToast(message, 'success', duration);
    },
    error: (message: string, duration?: number) => {
      showToast(message, 'error', duration);
    },
    info: (message: string, duration?: number) => {
      showToast(message, 'info', duration);
    },
  };
}

