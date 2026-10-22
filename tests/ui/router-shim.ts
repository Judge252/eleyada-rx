export const useRouter = () => ({
  replace: (path: string) => {
    window.uiNavigation = path;
  },
  refresh: () => {},
});
declare global {
  interface Window {
    uiNavigation?: string;
  }
}
