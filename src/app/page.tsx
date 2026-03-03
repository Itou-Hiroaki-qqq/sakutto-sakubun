"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  getNextQuestion,
  checkReadyOrGetMore,
  getEssay,
  getHints,
  reviewHandwrittenImage,
  getThemeHistory,
  addThemeToHistory,
  getSavedRules,
} from "./actions";
import { createClient } from "@/lib/supabase/client";
import type { EssayConfig, ChatMessage, AppPhase, TargetLevel, ImageReviewResult } from "@/types";

const PENDING_RULE_KEY = "sakubun_pending_rule";
const PENDING_CONFIG_KEY = "sakubun_pending_config";
const AUTO_START_QUESTIONS_KEY = "sakubun_auto_start_questions";

/** 画像をリサイズ・圧縮して base64 を返す（送信サイズ削減で Server Action 制限を回避） */
function compressImageToBase64(file: File, maxSize = 1200, quality = 0.85): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const scale = maxSize / Math.max(w, h);
      const cw = scale >= 1 ? w : Math.round(w * scale);
      const ch = scale >= 1 ? h : Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas に描画できません"));
        return;
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      try {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const b64 = dataUrl.split(",")[1];
        if (b64) resolve({ base64: b64, mimeType: "image/jpeg" });
        else reject(new Error("画像の変換に失敗しました"));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像の読み込みに失敗しました"));
    };
    img.src = url;
  });
}

const TARGET_LEVEL_OPTIONS: { value: TargetLevel; label: string }[] = [
  { value: "grade_1", label: "小学1年" },
  { value: "grade_2", label: "小学2年" },
  { value: "grade_3", label: "小学3年" },
  { value: "grade_4", label: "小学4年" },
  { value: "grade_5", label: "小学5年" },
  { value: "grade_6", label: "小学6年" },
  { value: "junior_high", label: "中学生" },
  { value: "high_school", label: "高校生" },
  { value: "general", label: "一般" },
  { value: "other", label: "その他" },
];

export default function Home() {
  const [phase, setPhase] = useState<AppPhase>("config");
  const [config, setConfig] = useState<EssayConfig>({
    theme: "",
    wordCount: 400,
    targetLevel: "grade_4",
    extraRules: "",
  });
  /** 文字数入力欄の表示用（編集中は空や「4」などを許容） */
  const [wordCountInput, setWordCountInput] = useState("400");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [essayResult, setEssayResult] = useState("");
  const [hintsResult, setHintsResult] = useState("");
  const [essayExtraContent, setEssayExtraContent] = useState("");
  const [hintsExtraContent, setHintsExtraContent] = useState("");
  /** ヒントの表示方法: null=未選択, "step"=ワンステップずつ, "full"=まるごと */
  const [hintDisplayMode, setHintDisplayMode] = useState<null | "step" | "full">(null);
  /** ワンステップ表示で現在まで表示しているステップの index（0 始まり） */
  const [hintStepIndex, setHintStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const answerTextareaRef = useRef<HTMLTextAreaElement>(null);
  /** 音声入力: どの入力先で認識中か（null=停止中） */
  const [voiceInputTarget, setVoiceInputTarget] = useState<null | "answer" | "essay" | "hints">(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  /** 画像添削: アップロード画像・プレビューURL・結果 */
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [reviewResult, setReviewResult] = useState<ImageReviewResult | null>(null);
  /** 画像添削用の目標文字数・ルール（mode_select から来ない場合は任意入力） */
  const [reviewWordCount, setReviewWordCount] = useState<number | "">("");
  const [reviewRules, setReviewRules] = useState("");
  /** 画像添削画面の「戻る」で戻る先（essay または hints） */
  const [phaseBeforeImageReview, setPhaseBeforeImageReview] = useState<"essay" | "hints" | null>(null);
  /** テーマ履歴（過去7件）・保存済みルール・UI状態 */
  const [themeHistory, setThemeHistory] = useState<string[]>([]);
  const [savedRules, setSavedRules] = useState<{ id: number; name: string; content: string }[]>([]);
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement>(null);
  const extraRulesTextareaRef = useRef<HTMLTextAreaElement>(null);
  /** ルール保存確認モーダル（作文をはじめる + その他ルール入力済み時に表示） */
  const [ruleSaveConfirmOpen, setRuleSaveConfirmOpen] = useState(false);
  /** その他ルールが「保存したルールを使う」で選んだものか（その場合は保存確認を出さない） */
  const [extraRulesFromSavedRule, setExtraRulesFromSavedRule] = useState(false);
  /** 選択中の保存ルールID（セレクトにルール名を表示するため） */
  const [selectedSavedRuleId, setSelectedSavedRuleId] = useState<string>("");
  const [logoutLoading, setLogoutLoading] = useState(false);
  const router = useRouter();

  /**
   * ヒント本文を表示用に整形する（◆冒頭/ステップタイトル、＜＞項目、・箇条書き）
   */
  const formatHintDisplayText = (raw: string): string => {
    return raw
      .split("\n")
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        const rest = line.match(/^(\s*)/)?.[1] ?? "";
        if (/^\*\*作文の/.test(t) || /^\*\*ステップ[０-９0-9]/.test(t)) {
          const inner = t.replace(/^\*\*|\*\*$/g, "");
          return rest + "◆" + inner;
        }
        if (/^\*\*[^*]+\*\*\s*$/.test(t)) {
          const inner = t.replace(/^\*\*|\*\*$/g, "");
          return rest + "◆" + inner;
        }
        const itemMatch = t.match(/^\*\s+\*\*【([^】]+)】\*\*\s*(.*)$/);
        if (itemMatch) return rest + "＜" + itemMatch[1] + "＞ " + itemMatch[2].trim();
        const itemMatch2 = t.match(/^\*\s+\*\*([^*]+?)\*\*\s*[：:]?\s*(.*)$/);
        if (itemMatch2) {
          const title = itemMatch2[1].replace(/^【|】$/g, "").trim();
          const tail = itemMatch2[2].trim();
          return rest + "＜" + title + "＞" + (tail ? " " + tail : "");
        }
        if (/^\*\s+[^*]/.test(t)) {
          const content = t.replace(/^\*\s+/, "");
          return rest + "・" + content;
        }
        return line;
      })
      .join("\n");
  };

  /**
   * 整形したヒント文字列を表示用にレンダー（◆は太字+やや大、＜＞は太字、ステップ間に空行）
   */
  const renderFormattedHint = (formatted: string) => {
    const lines = formatted.split("\n");
    const nodes: React.ReactNode[] = [];
    lines.forEach((line, i) => {
      const isTitleLine = line.trimStart().startsWith("◆");
      if (isTitleLine && i > 0) {
        nodes.push(<div key={`space-${i}`} className="h-4 shrink-0" aria-hidden />);
      }
      const parts: React.ReactNode[] = [];
      let remaining = line;
      while (remaining.includes("＜") && remaining.includes("＞")) {
        const before = remaining.slice(0, remaining.indexOf("＜"));
        const start = remaining.indexOf("＜") + 1;
        const end = remaining.indexOf("＞", start);
        const boldText = remaining.slice(start, end);
        const after = remaining.slice(end + 1);
        if (before) parts.push(before);
        parts.push(<strong key={`b-${parts.length}`}>{boldText}</strong>);
        remaining = after;
      }
      if (remaining) parts.push(remaining);
      const content = <>{parts}</>;
      if (isTitleLine) {
        nodes.push(
          <div key={i} className="font-bold text-[1.05em] text-foreground">
            {content}
          </div>
        );
      } else {
        nodes.push(
          <div key={i} className="text-foreground">
            {content}
          </div>
        );
      }
    });
    return nodes;
  };

  /**
   * ヒント本文をステップの配列に分割する。
   * - 第1ステップ: 「---」＋冒頭タイトル＋導入段落まで（**ステップ１：の直前まで）
   * - 以降: 「**ステップＮ：...**」のタイトルとその内容を1ブロックに
   * - 最後: 「---」＋まとめを1ブロックに
   */
  const parseHintSteps = (text: string): string[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const stepTitleRe = /\*\*ステップ[０-９0-9]/;
    if (!stepTitleRe.test(trimmed)) {
      const byDoubleNewline = trimmed.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
      if (byDoubleNewline.length > 1) return byDoubleNewline;
      return [trimmed];
    }

    const introEnd = trimmed.search(/\n(?=\*\*ステップ[０-９0-9])/);
    const intro = introEnd >= 0 ? trimmed.slice(0, introEnd).trim() : trimmed;
    const rest = introEnd >= 0 ? trimmed.slice(introEnd).trim() : "";

    if (!rest) return [intro];

    const stepBlocks = rest.split(/\n(?=\*\*ステップ[０-９0-9])/).map((s) => s.trim()).filter(Boolean);
    const steps: string[] = [intro];

    const lastBlock = stepBlocks[stepBlocks.length - 1];
    const summarySep = "\n\n---\n\n";
    if (stepBlocks.length > 0 && lastBlock.includes(summarySep)) {
      const lastParts = lastBlock.split(summarySep);
      const stepNContent = lastParts[0].trim();
      const summaryContent = lastParts.slice(1).join(summarySep).trim();
      if (stepBlocks.length > 1) steps.push(...stepBlocks.slice(0, -1));
      if (stepNContent) steps.push(stepNContent);
      if (summaryContent) steps.push("---\n\n" + summaryContent);
    } else {
      steps.push(...stepBlocks);
    }

    return steps.filter(Boolean);
  };

  /** 質疑エリアを常に最新（下）までスクロール */
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  /** 回答テキストエリア: 文字量に応じて高さを自動調整（音声入力時も反映） */
  useEffect(() => {
    const ta = answerTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [currentAnswer]);

  /** 音声入力: アンマウント時に認識を停止 */
  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
    };
  }, []);

  /** 画像プレビューURLの解放 */
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  /** ルール保存ページから戻ったとき、質疑応答を自動開始 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(AUTO_START_QUESTIONS_KEY) !== "1") return;
    sessionStorage.removeItem(AUTO_START_QUESTIONS_KEY);
    const configStr = sessionStorage.getItem(PENDING_CONFIG_KEY);
    if (!configStr) return;
    sessionStorage.removeItem(PENDING_CONFIG_KEY);
    try {
      const restored = JSON.parse(configStr) as EssayConfig;
      setConfig(restored);
      setPhase("questions");
      setMessages([]);
      setError(null);
      setLoading(true);
      getNextQuestion(restored, [])
        .then(({ text, done }) => {
          setMessages([{ role: "ai", content: text }]);
          if (done) setPhase("mode_select");
        })
        .catch((e) =>
          setError(e instanceof Error ? e.message : "質問の取得に失敗しました")
        )
        .finally(() => setLoading(false));
      addThemeToHistory(restored.theme.trim()).catch(() => {});
    } catch {
      // ignore parse error
    }
  }, []);

  /** 設定画面表示時にテーマ履歴・保存済みルールを取得 */
  useEffect(() => {
    if (phase !== "config") return;
    getThemeHistory().then(setThemeHistory).catch(() => {});
    getSavedRules().then(setSavedRules).catch(() => {});
  }, [phase]);

  /** テーマ履歴ドロップダウン外クリックで閉じる */
  useEffect(() => {
    if (!showThemeDropdown) return;
    const close = (e: MouseEvent) => {
      if (themeDropdownRef.current?.contains(e.target as Node)) return;
      const themeInput = document.getElementById("theme");
      if (themeInput?.contains(e.target as Node)) return;
      setShowThemeDropdown(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showThemeDropdown]);

  /** その他ルール textarea: 文字量に応じて高さを自動調整（全体が表示されるまで伸ばす） */
  useEffect(() => {
    const ta = extraRulesTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxH = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.7) : 800;
    ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`;
  }, [config.extraRules]);

  /** 質疑応答: AIの質問表示後、入力欄にフォーカスする */
  useEffect(() => {
    if (phase !== "questions" || loading) return;
    if (messages.length === 0 || messages[messages.length - 1].role !== "ai") return;
    const t = setTimeout(() => {
      answerTextareaRef.current?.focus();
    }, 100);
    return () => clearTimeout(t);
  }, [phase, loading, messages]);

  /** 作文開始の本体（質問フェーズへ・テーマ履歴に追加） */
  const startEssayFlow = async () => {
    if (!config.theme.trim()) {
      setError("作文テーマを入力してください");
      return;
    }
    const wc = Number(wordCountInput);
    const normalizedWc = Number.isFinite(wc) && wc >= 100 && wc <= 2000 ? wc : 400;
    const configToUse = { ...config, wordCount: normalizedWc };
    setConfig((c) => ({ ...c, wordCount: normalizedWc }));
    setWordCountInput(String(normalizedWc));
    setRuleSaveConfirmOpen(false);
    setError(null);
    setLoading(true);
    try {
      addThemeToHistory(configToUse.theme.trim()).catch(() => {});
      setPhase("questions");
      setMessages([]);
      const { text, done } = await getNextQuestion(configToUse, []);
      setMessages([{ role: "ai", content: text }]);
      if (done) setPhase("mode_select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "質問の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 「作文をはじめる」クリック: その他ルール入力済みなら保存確認（保存済みルール選択時は出さない）、なければ開始 */
  const handleStart = () => {
    if (!config.theme.trim()) {
      setError("作文テーマを入力してください");
      return;
    }
    setError(null);
    if (config.extraRules.trim() && !extraRulesFromSavedRule) {
      setRuleSaveConfirmOpen(true);
      return;
    }
    startEssayFlow();
  };

  /** ルール保存確認で「いいえ」→ そのまま作文開始 */
  const handleRuleSaveNo = () => {
    startEssayFlow();
  };

  /** ルール保存確認で「はい」→ 作文ルール保存ページへ（保存後に質疑応答へ進むよう設定を退避） */
  const handleRuleSaveYes = () => {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(PENDING_RULE_KEY, config.extraRules.trim());
      sessionStorage.setItem(PENDING_CONFIG_KEY, JSON.stringify(config));
    }
    setRuleSaveConfirmOpen(false);
    router.push("/rules/save");
  };

  /** これまでの質問で作文を書きたい → 十分ならモード選択へ、足りなければ「もう少し…」＋質問を続ける */
  const handleRequestEssayOrContinue = async () => {
    setError(null);
    setLoading(true);
    const userMessage: ChatMessage = {
      role: "user",
      content: "これまでの質問で作文を書きたいです。",
    };
    try {
      const { text, done } = await checkReadyOrGetMore(config, messages);
      setMessages((prev) => [
        ...prev,
        userMessage,
        { role: "ai", content: text },
      ]);
      if (done) setPhase("mode_select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** この質問を飛ばして次の質問を取得 */
  const handleSkipQuestion = async () => {
    setError(null);
    setLoading(true);
    const skipUserMessage: ChatMessage = {
      role: "user",
      content: "この質問はスキップして次の質問をしてください",
    };
    const newMessages: ChatMessage[] = [...messages, skipUserMessage];
    setMessages(newMessages);
    try {
      const { text, done } = await getNextQuestion(config, newMessages);
      setMessages((prev) => [...prev, { role: "ai", content: text }]);
      if (done) setPhase("mode_select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "質問の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 回答送信 → 次の質問を取得 */
  const handleSubmitAnswer = async () => {
    const answer = currentAnswer.trim();
    if (!answer) return;
    setError(null);
    setLoading(true);
    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: answer },
    ];
    setMessages(newMessages);
    setCurrentAnswer("");
    const ta = answerTextareaRef.current;
    if (ta) {
      ta.style.height = "auto";
    }
    try {
      const { text, done } = await getNextQuestion(config, newMessages);
      setMessages((prev) => [...prev, { role: "ai", content: text }]);
      if (done) setPhase("mode_select");
    } catch (e) {
      setError(e instanceof Error ? e.message : "質問の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 作文を完成させる */
  const handleCompleteEssay = async () => {
    setError(null);
    setLoading(true);
    setPhase("essay");
    setEssayResult("");
    try {
      const text = await getEssay(config, messages);
      setEssayResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作文の生成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** ヒントモード */
  const handleHints = async () => {
    setError(null);
    setLoading(true);
    setPhase("hints");
    setHintsResult("");
    setHintDisplayMode(null);
    setHintStepIndex(0);
    try {
      const text = await getHints(config, messages);
      setHintsResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ヒントの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 作文を追加内容で再生成 */
  const handleRecreateEssay = async () => {
    setError(null);
    setLoading(true);
    setEssayResult("");
    try {
      const text = await getEssay(config, messages, essayExtraContent.trim() || undefined);
      setEssayResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作文の再生成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** ヒントを追加内容で再生成 */
  const handleRecreateHints = async () => {
    setError(null);
    setLoading(true);
    setHintsResult("");
    setHintDisplayMode(null);
    setHintStepIndex(0);
    try {
      const text = await getHints(config, messages, hintsExtraContent.trim() || undefined);
      setHintsResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ヒントの再生成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 音声入力開始/停止（target: 反映先の入力） */
  const handleVoiceInput = (target: "answer" | "essay" | "hints") => {
    if (typeof window === "undefined") return;
    const SpeechRecognitionAPI = window.SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setError("お使いのブラウザでは音声入力に対応していません。");
      return;
    }
    if (voiceInputTarget === target) {
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
      setVoiceInputTarget(null);
      return;
    }
    if (voiceInputTarget) {
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
    }
    setError(null);
    const rec = new SpeechRecognitionAPI() as SpeechRecognition;
    rec.lang = "ja-JP";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[e.results.length - 1]?.[0]?.transcript ?? "";
      if (!transcript) return;
      if (target === "answer") setCurrentAnswer((prev) => (prev ? `${prev}${transcript}` : transcript));
      if (target === "essay") setEssayExtraContent((prev) => (prev ? `${prev}${transcript}` : transcript));
      if (target === "hints") setHintsExtraContent((prev) => (prev ? `${prev}${transcript}` : transcript));
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "not-allowed") setError("マイクの使用が許可されていません。");
      else if (e.error !== "aborted") setError("音声の認識に失敗しました。");
      setVoiceInputTarget(null);
    };
    rec.onend = () => setVoiceInputTarget(null);
    speechRecognitionRef.current = rec;
    rec.start();
    setVoiceInputTarget(target);
  };

  /** 画像ファイル選択時（プレビュー表示・結果クリア） */
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpeg|jpg)$/)) {
      setError("PNG または JPG 画像を選んでください。");
      return;
    }
    setError(null);
    setReviewResult(null);
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(URL.createObjectURL(file));
    setImageFile(file);
  };

  /** 手書き作文画像を添削 */
  const handleReviewImage = async () => {
    if (!imageFile) {
      setError("画像を選択してください。");
      return;
    }
    setError(null);
    setLoading(true);
    setReviewResult(null);
    try {
      const { base64, mimeType } = await compressImageToBase64(imageFile);
      const theme = phaseBeforeImageReview && config.theme ? config.theme : undefined;
      const wordCount = typeof reviewWordCount === "number" ? reviewWordCount : config.wordCount;
      const rules = reviewRules.trim() || config.extraRules.trim() || undefined;
      const result = await reviewHandwrittenImage(base64, mimeType, {
        theme,
        wordCount,
        rules,
        targetLevel: config.targetLevel,
      });
      setReviewResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "添削に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** 最初からやり直す */
  const handleReset = () => {
    setPhase("config");
    setWordCountInput(String(config.wordCount));
    setMessages([]);
    setEssayResult("");
    setHintsResult("");
    setEssayExtraContent("");
    setHintsExtraContent("");
    setHintDisplayMode(null);
    setHintStepIndex(0);
    setImageFile(null);
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(null);
    setReviewResult(null);
    setReviewWordCount("");
    setReviewRules("");
    setPhaseBeforeImageReview(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        {/* ヘッダー */}
        <header className="mb-6 flex items-start justify-between gap-4 sm:mb-8">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              さくっと作文
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              AIが質問で情報を引き出し、作文をサポートします
            </p>
          </div>
          <button
            type="button"
            disabled={logoutLoading}
            onClick={async () => {
              setLogoutLoading(true);
              const supabase = createClient();
              await supabase.auth.signOut();
              router.push("/login");
              router.refresh();
            }}
            className="shrink-0 rounded-sm border border-card-border bg-card px-3 py-1.5 text-sm text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            {logoutLoading ? "…" : "ログアウト"}
          </button>
        </header>

        {/* エラー表示 */}
        {error && (
          <div
            className="mb-4 rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* ① 設定画面 */}
        {phase === "config" && (
          <section
            className="rounded-lg border border-card-border bg-card p-5 shadow-sm sm:p-6"
            aria-label="作文の設定"
          >
            <h2 className="mb-4 text-lg font-semibold">作文の設定</h2>
            <div className="space-y-4">
              <div className="relative" ref={themeDropdownRef}>
                <label
                  htmlFor="theme"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  作文テーマ <span className="text-red-500">*</span>
                </label>
                <input
                  id="theme"
                  type="text"
                  value={config.theme}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, theme: e.target.value }))
                  }
                  onFocus={() => setShowThemeDropdown(true)}
                  autoComplete="off"
                  placeholder="例：夏休みの思い出"
                  className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
                {showThemeDropdown && themeHistory.length > 0 && (
                  <div
                    className="absolute top-full left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-sm border border-card-border bg-card py-1 shadow-sm"
                    role="listbox"
                  >
                    {themeHistory.map((t, i) => (
                      <button
                        key={i}
                        type="button"
                        role="option"
                        aria-selected={config.theme === t}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setConfig((c) => ({ ...c, theme: t }));
                          setShowThemeDropdown(false);
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label
                  htmlFor="wordCount"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  文字数
                </label>
                <input
                  id="wordCount"
                  type="number"
                  min={100}
                  max={2000}
                  step={100}
                  value={wordCountInput}
                  onChange={(e) => setWordCountInput(e.target.value)}
                  onBlur={() => {
                    const num = Number(wordCountInput);
                    const normalized = Number.isFinite(num) && num >= 100 && num <= 2000 ? num : 400;
                    setConfig((c) => ({ ...c, wordCount: normalized }));
                    setWordCountInput(String(normalized));
                  }}
                  className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label
                  htmlFor="targetLevel"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  対象レベル
                </label>
                <select
                  id="targetLevel"
                  value={config.targetLevel}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      targetLevel: e.target.value as EssayConfig["targetLevel"],
                    }))
                  }
                  className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  {TARGET_LEVEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="extraRules"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  その他ルール <span className="text-muted-foreground">（任意）</span>
                </label>
                {savedRules.length > 0 && (
                  <div className="mb-2">
                    <span className="mr-2 text-sm text-muted-foreground">
                      保存したルールを使う:
                    </span>
                    <select
                      value={selectedSavedRuleId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedSavedRuleId(id);
                        if (!id) {
                          setExtraRulesFromSavedRule(false);
                          return;
                        }
                        const r = savedRules.find((x) => String(x.id) === id);
                        if (r) {
                          setConfig((c) => ({ ...c, extraRules: r.content }));
                          setExtraRulesFromSavedRule(true);
                        }
                      }}
                      className="rounded-sm border border-card-border bg-background px-2 py-1.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="">選択してください</option>
                      {savedRules.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <textarea
                  ref={extraRulesTextareaRef}
                  id="extraRules"
                  value={config.extraRules}
                  onChange={(e) => {
                    setConfig((c) => ({ ...c, extraRules: e.target.value }));
                    setExtraRulesFromSavedRule(false);
                    setSelectedSavedRuleId("");
                    const ta = extraRulesTextareaRef.current;
                    if (ta) {
                      ta.style.height = "auto";
                      const maxH = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.7) : 800;
                      ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`;
                    }
                  }}
                  placeholder="例：段落は3つに分ける"
                  rows={2}
                  className="min-h-10 w-full resize-none overflow-y-auto rounded-sm border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
            </div>
            {/* ルール保存確認モーダル */}
            {ruleSaveConfirmOpen && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rule-save-confirm-title"
              >
                <div className="w-full max-w-sm rounded-lg border border-card-border bg-card p-5 shadow-lg">
                  <h3 id="rule-save-confirm-title" className="font-semibold">
                    設定したルールを今後も使えるように保存しますか
                  </h3>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleRuleSaveNo}
                      disabled={loading}
                      className="rounded-sm border border-card-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                    >
                      いいえ
                    </button>
                    <button
                      type="button"
                      onClick={handleRuleSaveYes}
                      className="rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      はい
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-6">
              <button
                type="button"
                onClick={handleStart}
                disabled={loading}
                className="w-full rounded-sm bg-primary px-4 py-3 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50 sm:w-auto sm:min-w-[200px]"
              >
                {loading ? "準備中…" : "作文をはじめる"}
              </button>
            </div>
          </section>
        )}

        {/* ② 質問フェーズ（チャット風） */}
        {(phase === "questions" || phase === "mode_select") && (
          <section
            className="rounded-lg border border-card-border bg-card shadow-sm"
            aria-label="質問と回答"
          >
            <div className="flex max-h-[50vh] flex-col overflow-hidden sm:max-h-[60vh]">
              <div
                ref={chatScrollRef}
                className="flex-1 space-y-4 overflow-y-auto p-4"
              >
                {messages.map((msg, i) => {
                  const isLatestAiMessage =
                    msg.role === "ai" &&
                    phase === "questions" &&
                    i === messages.length - 1;
                  return (
                    <div
                      key={`${msg.role}-${i}`}
                      className={`flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`flex max-w-[85%] flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`rounded-2xl px-4 py-2.5 text-sm ${
                            msg.role === "ai"
                              ? "bg-muted text-foreground"
                              : "bg-primary text-primary-foreground"
                          }`}
                        >
                          <span className="whitespace-pre-wrap">{msg.content}</span>
                        </div>
                        {isLatestAiMessage && (
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={handleSkipQuestion}
                              disabled={loading}
                              className="text-xs text-muted-foreground underline transition hover:text-foreground disabled:opacity-50"
                            >
                              その質問は飛ばす
                            </button>
                            <button
                              type="button"
                              onClick={handleRequestEssayOrContinue}
                              disabled={loading}
                              className="text-xs text-muted-foreground underline transition hover:text-foreground disabled:opacity-50"
                            >
                              これまでの質問で作文を書きたい
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {loading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                        <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.2s]" />
                        <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.4s]" />
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {phase === "questions" && !loading && (
                <div className="border-t border-card-border p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <textarea
                      ref={answerTextareaRef}
                      value={currentAnswer}
                      rows={2}
                      onChange={(e) => {
                        setCurrentAnswer(e.target.value);
                        const ta = answerTextareaRef.current;
                        if (ta) {
                          ta.style.height = "auto";
                          ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
                        }
                      }}
                      onKeyDown={(e) =>
                        e.key === "Enter" && !e.shiftKey && handleSubmitAnswer()
                      }
                      placeholder="回答を入力..."
                      className="min-h-10 max-h-[240px] w-full flex-1 resize-none overflow-y-auto rounded-sm border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 sm:min-w-0"
                      aria-label="回答入力"
                    />
                    <div className="flex gap-2 sm:shrink-0">
                      <button
                        type="button"
                        onClick={() => handleVoiceInput("answer")}
                        title={voiceInputTarget === "answer" ? "音声入力を終了" : "音声入力"}
                        className={`rounded-sm border border-card-border px-3 py-2 text-sm transition hover:bg-muted disabled:opacity-50 ${voiceInputTarget === "answer" ? "bg-primary text-primary-foreground" : "bg-card"}`}
                      >
                        🎤{voiceInputTarget === "answer" ? "停止" : "音声入力"}
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitAnswer}
                        disabled={!currentAnswer.trim()}
                        className="rounded-sm bg-primary px-4 py-2 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                      >
                        送信
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ③ 作成モード選択 */}
            {phase === "mode_select" && !loading && (
              <div className="border-t border-card-border p-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  次のどちらにしますか？
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleCompleteEssay}
                    disabled={loading}
                    className="rounded-sm bg-primary px-4 py-2.5 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    作文を完成させる
                  </button>
                  <button
                    type="button"
                    onClick={handleHints}
                    disabled={loading}
                    className="rounded-sm border border-card-border bg-card px-4 py-2.5 font-medium transition hover:bg-muted disabled:opacity-50"
                  >
                    ヒントモード
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ④ 作文完成モード結果 */}
        {phase === "essay" && (
          <section
            className="rounded-lg border border-card-border bg-card p-5 shadow-sm sm:p-6"
            aria-label="完成した作文"
          >
            <h2 className="mb-4 text-lg font-semibold">完成した作文</h2>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.2s]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.4s]" />
                <span className="text-sm">作文を書いています…</span>
              </div>
            ) : (
              <div className="whitespace-pre-wrap rounded-sm bg-muted/50 p-4 text-foreground">
                {essayResult}
              </div>
            )}
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPhase("mode_select")}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  1つ前の画面に戻る
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  最初からやり直す
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPhaseBeforeImageReview("essay");
                    setPhase("image_review");
                    setError(null);
                    setReviewResult(null);
                    setImageFile(null);
                    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
                    setImagePreviewUrl(null);
                    setReviewWordCount(config.wordCount);
                    setReviewRules(config.extraRules);
                  }}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  手書き作文を添削する
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleRecreateEssay}
                  disabled={loading}
                  className="w-full rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50 sm:w-auto"
                >
                  以下の内容を入れて作文をもう一度作成する
                </button>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <textarea
                    value={essayExtraContent}
                    onChange={(e) => setEssayExtraContent(e.target.value)}
                    placeholder="盛り込みたい内容を入力（例：もっと具体的なエピソードを入れてほしい）"
                    rows={3}
                    className="w-full flex-1 rounded-sm border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 sm:min-w-0"
                    aria-label="作文に盛り込む内容"
                  />
                  <button
                    type="button"
                    onClick={() => handleVoiceInput("essay")}
                    title={voiceInputTarget === "essay" ? "音声入力を終了" : "音声入力"}
                    className={`shrink-0 self-end rounded-sm border border-card-border px-3 py-2 text-sm transition hover:bg-muted sm:self-end ${voiceInputTarget === "essay" ? "bg-primary text-primary-foreground" : "bg-card"}`}
                  >
                    🎤{voiceInputTarget === "essay" ? "停止" : "音声入力"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ⑤ ヒントモード結果 */}
        {phase === "hints" && (
          <section
            className="rounded-lg border border-card-border bg-card p-5 shadow-sm sm:p-6"
            aria-label="作文のヒント"
          >
            <h2 className="mb-4 text-lg font-semibold">作文の手順とコツ</h2>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.2s]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0.4s]" />
                <span className="text-sm">ヒントを考えています…</span>
              </div>
            ) : hintsResult && hintDisplayMode === null ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  ヒントの表示方法を選んでください。
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setHintDisplayMode("step");
                      setHintStepIndex(0);
                    }}
                    className="rounded-sm border border-card-border bg-card px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
                  >
                    ヒントをワンステップずつ表示する
                  </button>
                  <button
                    type="button"
                    onClick={() => setHintDisplayMode("full")}
                    className="rounded-sm border border-card-border bg-card px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
                  >
                    ヒントをまるごと表示する
                  </button>
                </div>
              </div>
            ) : hintsResult && hintDisplayMode === "step" ? (
              <div className="flex flex-col gap-4">
                <div className="space-y-1 rounded-sm bg-muted/50 p-4 text-foreground">
                  {renderFormattedHint(
                    formatHintDisplayText(
                      parseHintSteps(hintsResult)
                        .slice(0, hintStepIndex + 1)
                        .join("\n\n")
                    )
                  )}
                </div>
                {parseHintSteps(hintsResult).length > hintStepIndex + 1 ? (
                  <button
                    type="button"
                    onClick={() => setHintStepIndex((i) => i + 1)}
                    className="w-full rounded-sm border border-primary bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 sm:w-auto"
                  >
                    次のステップ
                  </button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    すべてのステップを表示しました。
                  </p>
                )}
              </div>
            ) : hintsResult && hintDisplayMode === "full" ? (
              <div className="space-y-1 rounded-sm bg-muted/50 p-4 text-foreground">
                {renderFormattedHint(formatHintDisplayText(hintsResult))}
              </div>
            ) : null}
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPhase("mode_select")}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  1つ前の画面に戻る
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  最初からやり直す
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPhaseBeforeImageReview("hints");
                    setPhase("image_review");
                    setError(null);
                    setReviewResult(null);
                    setImageFile(null);
                    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
                    setImagePreviewUrl(null);
                    setReviewWordCount(config.wordCount);
                    setReviewRules(config.extraRules);
                  }}
                  className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  手書き作文を添削する
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleRecreateHints}
                  disabled={loading}
                  className="w-full rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50 sm:w-auto"
                >
                  以下の内容を入れてヒントをもう一度作成する
                </button>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <textarea
                    value={hintsExtraContent}
                    onChange={(e) => setHintsExtraContent(e.target.value)}
                    placeholder="ヒントに反映したい内容を入力（例：段落の区切り方をもっと詳しく）"
                    rows={3}
                    className="w-full flex-1 rounded-sm border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 sm:min-w-0"
                    aria-label="ヒントに反映する内容"
                  />
                  <button
                    type="button"
                    onClick={() => handleVoiceInput("hints")}
                    title={voiceInputTarget === "hints" ? "音声入力を終了" : "音声入力"}
                    className={`shrink-0 self-end rounded-sm border border-card-border px-3 py-2 text-sm transition hover:bg-muted sm:self-end ${voiceInputTarget === "hints" ? "bg-primary text-primary-foreground" : "bg-card"}`}
                  >
                    🎤{voiceInputTarget === "hints" ? "停止" : "音声入力"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ⑥ 手書き作文の画像添削 */}
        {phase === "image_review" && (
          <section
            className="rounded-lg border border-card-border bg-card p-5 shadow-sm sm:p-6"
            aria-label="手書き作文を添削"
          >
            <h2 className="mb-4 text-lg font-semibold">手書き作文の画像添削</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              手書き作文の画像（PNG/ JPG）をアップロードすると、OCR・誤字脱字・文字数・ルール・良い点・改善点を添削します。
            </p>

            <div className="mb-4 space-y-2">
              <label className="block text-sm font-medium text-foreground">
                目標文字数（任意）
              </label>
              <input
                type="number"
                min={1}
                value={reviewWordCount === "" ? "" : reviewWordCount}
                onChange={(e) =>
                  setReviewWordCount(e.target.value === "" ? "" : Number(e.target.value))
                }
                placeholder="例：400"
                className="w-full max-w-[120px] rounded-sm border border-card-border bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
              <label className="mt-2 block text-sm font-medium text-foreground">
                ルール（任意）
              </label>
              <input
                type="text"
                value={reviewRules}
                onChange={(e) => setReviewRules(e.target.value)}
                placeholder="例：段落は3つに分ける"
                className="w-full rounded-sm border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-foreground">
                画像を選ぶ（PNG / JPG）
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                onChange={handleImageSelect}
                className="block w-full text-sm text-foreground file:mr-2 file:rounded-sm file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
              />
              {imagePreviewUrl && (
                <div className="mt-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreviewUrl}
                    alt="アップロードした作文"
                    className="max-h-48 rounded-sm border border-card-border object-contain"
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleReviewImage}
              disabled={loading || !imageFile}
              className="mb-6 rounded-sm bg-primary px-4 py-2.5 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "添削中…" : "添削する"}
            </button>

            {loading && (
              <div className="mb-6 flex items-center gap-2 text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                <span className="text-sm">画像を分析しています…</span>
              </div>
            )}

            {reviewResult && !loading && (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  {["grade_1", "grade_2", "grade_3"].includes(config.targetLevel)
                    ? "AIによるてんさくはけっこうまちがいがあるので、ほごしゃやじぶんでも、かならずかくにんしてください"
                    : "AIによる添削はけっこう間違いがあるので、保護者や自分でも必ず確認してください"}
                </p>
                <div className="space-y-4 rounded-sm border border-card-border bg-muted/30 p-4">
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-foreground">抽出テキスト</h3>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {reviewResult.extractedText}
                  </p>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-foreground">誤字脱字</h3>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {reviewResult.typos}
                  </p>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-foreground">文字数評価</h3>
                  <p className="text-sm text-foreground">{reviewResult.wordCountEval}</p>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-foreground">ルール評価</h3>
                  <p className="text-sm text-foreground">{reviewResult.ruleEval}</p>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-foreground">良い点</h3>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {reviewResult.goodPoints}
                  </p>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-foreground">改善点</h3>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {reviewResult.improvements}
                  </p>
                </div>
              </div>
              </>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (phaseBeforeImageReview) setPhase(phaseBeforeImageReview);
                  else setPhase("mode_select");
                }}
                className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
              >
                1つ前の画面に戻る
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-sm border border-card-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
              >
                最初からやり直す
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
