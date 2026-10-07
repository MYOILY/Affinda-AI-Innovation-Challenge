import React, { useState, useRef } from "react";
import { 
  Radio, 
  Upload, 
  Loader2, 
  AlertTriangle, 
  ShieldAlert, 
  Info, 
  Clock, 
  Layers
} from "lucide-react";
import "./App.css";

export default function App() {
  const [elevenKey, setElevenKey] = useState(localStorage.getItem("xi_key") || "");
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem("oai_key") || "");
  const [file, setFile] = useState(null);
  const [processingState, setProcessingState] = useState("IDLE"); // IDLE | TRANSCRIBING | CLASSIFYING
  const [notifications, setNotifications] = useState([
    {
      id: "init-1",
      timestamp: "10:42 AM",
      urgency: "HIGH",
      category: "Perimeter",
      summary: "Unauthorized individual attempting north gate breach",
      transcript: "Unit four to dispatch, we have a suspect scaling the perimeter fence by the north gate.",
      actionRequired: "Deploy patrol unit immediately"
    }
  ]);

  const fileInputRef = useRef(null);

  // 1. Fallback Heuristic Classifier (runs if no OpenAI key is supplied)
  const ruleBasedClassifier = (text) => {
    const lower = text.toLowerCase();
    if (lower.match(/(fire|unconscious|code red|bleeding|explosion|collapsed|weapon|mayday)/)) {
      return {
        urgency: "CRITICAL",
        category: "Life Safety / Medical",
        summary: "Critical life safety incident reported",
        actionRequired: "Dispatch EMT and Fire Rescue immediately"
      };
    }
    if (lower.match(/(intruder|breach|fight|theft|suspect|unauthorized|perimeter|alarm)/)) {
      return {
        urgency: "HIGH",
        category: "Security Incident",
        summary: "Active security breach or threat identified",
        actionRequired: "Dispatch security unit to intercept"
      };
    }
    if (lower.match(/(spill|leak|broken|elevator|power|hazard|blocked)/)) {
      return {
        urgency: "MEDIUM",
        category: "Facility / Hazard",
        summary: "Facility maintenance or safety hazard",
        actionRequired: "Alert facilities and cordon area"
      };
    }
    return {
      urgency: "LOW",
      category: "Routine Traffic",
      summary: "Routine status check or communication",
      actionRequired: "Log event. No dispatch required."
    };
  };

  // 2. LLM Classifier (OpenAI gpt-4o-mini structured output)
  const classifyWithLLM = async (transcriptText) => {
    if (!openaiKey) {
      return ruleBasedClassifier(transcriptText);
    }

    try {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${geminiApiKey}`, // Your Google AI Studio API key
          },
          body: JSON.stringify({
            model: "gemini-3.8-flash",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: "You are an incident classification engine. Return JSON only..."
              },
              { role: "user", content: transcriptText }
            ]
          })
        }
      );

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);

    } catch (err) {
      console.warn("LLM error, reverting to heuristic:", err);
      return ruleBasedClassifier(transcriptText);
    }
  };

  // 3. Main Pipeline: Transcribe (ElevenLabs) -> Classify -> Add to Feed
  const handleProcessAudio = async () => {
    if (!elevenKey) {
      alert("Please provide your ElevenLabs API Key.");
      return;
    }
    if (!file) {
      alert("Please upload an audio transmission file.");
      return;
    }

    try {
      // Step A: Transcribe
      setProcessingState("TRANSCRIBING");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("model_id", "scribe_v1");

      const sttRes = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": elevenKey },
        body: formData,
      });

      if (!sttRes.ok) throw new Error(`STT failed: ${sttRes.statusText}`);
      const sttData = await sttRes.json();
      const transcriptText = sttData.text || "[Unintelligible transmission]";

      // Step B: Classify Urgency
      setProcessingState("CLASSIFYING");
      const classification = await classifyWithLLM(transcriptText);

      // Step C: Push Notification Card to Feed
      const newAlert = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        transcript: transcriptText,
        ...classification
      };

      setNotifications((prev) => [newAlert, ...prev]);
    } catch (err) {
      alert(err.message);
    } finally {
      setProcessingState("IDLE");
      setFile(null);
    }
  };

  const getUrgencyIcon = (urgency) => {
    switch (urgency) {
      case "CRITICAL": return <ShieldAlert size={12} />;
      case "HIGH": return <AlertTriangle size={12} />;
      default: return <Info size={12} />;
    }
  };

  return (
    <div className="phone-container">
      <div className="phone-notch" />

      {/* Header */}
      <div className="header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Radio size={18} color="#22c55e" />
          <span style={{ fontWeight: 800, fontSize: 15 }}>RADIO SENTINEL</span>
        </div>
        <span className="badge">
          {processingState === "IDLE" ? "LIVE MONITOR" : processingState}
        </span>
      </div>

      {/* Ingest & Controls */}
      <div className="ingest-panel">
        <input
          type="password"
          className="input-box"
          placeholder="ElevenLabs Key (xi-...)"
          value={elevenKey}
          onChange={(e) => {
            setElevenKey(e.target.value);
            localStorage.setItem("xi_key", e.target.value);
          }}
        />
        <input
          type="password"
          className="input-box"
          placeholder="OpenAI Key (optional for LLM classification)"
          value={openaiKey}
          onChange={(e) => {
            setOpenaiKey(e.target.value);
            localStorage.setItem("oai_key", e.target.value);
          }}
        />

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          accept="audio/*"
          onChange={(e) => setFile(e.target.files[0])}
        />

        <div className="file-dropzone" onClick={() => fileInputRef.current.click()}>
          <Upload size={16} style={{ color: "#94a3b8", marginBottom: 2 }} />
          <div style={{ fontSize: 12 }}>
            {file ? file.name : "Load Simulated Walkie Transmission"}
          </div>
        </div>

        <button
          className="btn-primary"
          onClick={handleProcessAudio}
          disabled={!file || processingState !== "IDLE"}
        >
          {processingState !== "IDLE" ? (
            <>
              <Loader2 className="animate-spin" size={14} />
              {processingState === "TRANSCRIBING" ? "Transcribing Audio..." : "Classifying Urgency..."}
            </>
          ) : (
            "Ingest & Classify Audio"
          )}
        </button>
      </div>

      {/* Alert Feed Header */}
      <div className="feed-header">
        <span>Incident Feed ({notifications.length})</span>
        <Layers size={13} />
      </div>

      {/* Scrollable Notification Feed */}
      <div className="feed-container">
        {notifications.map((item) => (
          <div key={item.id} className="alert-card">
            <div className="alert-top">
              <span className={`urgency-pill urgency-${item.urgency}`}>
                {getUrgencyIcon(item.urgency)}
                {item.urgency} • {item.category}
              </span>
              <span style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 3 }}>
                <Clock size={11} /> {item.timestamp}
              </span>
            </div>

            <div className="alert-title">{item.summary}</div>
            
            <div className="alert-transcript">
              "{item.transcript}"
            </div>

            <div className="alert-action">
              ⚡ Action: {item.actionRequired}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}