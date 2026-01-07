import { create } from 'zustand';
import { ToastData, ToastType } from '../components/Toast';

interface ToastState {
  toasts: ToastData[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

let toastIdCounter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  
  showToast: (message: string, type: ToastType = 'info', duration?: number) => {
    const id = `toast-${toastIdCounter++}`;
    const toast: ToastData = {
      id,
      message,
      type,
      duration,
    };
    
    set((state) => ({
      toasts: [...state.toasts, toast],
    }));
  },
  
  removeToast: (id: string) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },
}));

