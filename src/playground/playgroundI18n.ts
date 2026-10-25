import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const resources = {
  en: {
    starlight: {
      run: "Run",
      share: "Share",
      openExamples: "Examples",
      copyShareLink: "Copy share link",
      shareAccessNotice: "Anyone with the link can view this snapshot.",
      shareLinkCopiedUntil: "Share link copied (available until {{date}})",
      shareLinkCopied: "Share link copied",
      sharing: "Sharing",
      cancel: "Cancel",
      wasmWaiting: "WASM waiting",
      wasmLoading: "WASM loading",
      wasmInitializing: "WASM initializing",
      wasmReady: "WASM ready",
      wasmError: "WASM error",
      retry: "Retry",
      sourceCandidates: "Matching MCL locations",
    },
  },
  ja: {
    starlight: {
      run: "実行",
      share: "共有",
      openExamples: "サンプル",
      copyShareLink: "共有リンクをコピー",
      shareAccessNotice: "リンクを知っている人はこのスナップショットを閲覧できます。",
      shareLinkCopiedUntil: "共有リンクをコピーしました（{{date}}まで有効）",
      shareLinkCopied: "共有リンクをコピーしました",
      sharing: "共有中",
      cancel: "キャンセル",
      wasmWaiting: "WASM準備中",
      wasmLoading: "WASM読み込み中",
      wasmInitializing: "WASM初期化中",
      wasmReady: "WASM準備完了",
      wasmError: "WASMエラー",
      retry: "再試行",
      sourceCandidates: "対応するMCLの箇所",
    },
  },
} as const;

declare global {
  namespace StarlightApp {
    interface I18n {
      run: string;
      share: string;
      openExamples: string;
      copyShareLink: string;
      shareAccessNotice: string;
      shareLinkCopiedUntil: string;
      shareLinkCopied: string;
      sharing: string;
      cancel: string;
      wasmWaiting: string;
      wasmLoading: string;
      wasmInitializing: string;
      wasmReady: string;
      wasmError: string;
      retry: string;
      sourceCandidates: string;
    }
  }
}

const language =
  typeof document === "undefined"
    ? "ja"
    : document.documentElement.lang.toLowerCase().startsWith("en")
      ? "en"
      : "ja";
export const playgroundLocale = language === "en" ? "en-US" : "ja-JP";

void i18n.use(initReactI18next).init({
  resources,
  defaultNS: "starlight",
  lng: language,
  fallbackLng: "ja",
  interpolation: { escapeValue: false },
});

export default i18n;
