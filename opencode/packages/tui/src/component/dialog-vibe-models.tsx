import { createSignal } from "solid-js"
import { DialogModel } from "./dialog-model"
import { useDialog } from "../ui/dialog"
import { useLocal } from "../context/local"

type ModelRef = { providerID: string; modelID: string }

export function DialogVibeModels() {
  const dialog = useDialog()
  const local = useLocal()
  const [planner, setPlanner] = createSignal<ModelRef>()

  return (
    <DialogModel
      title="Select smart planner model"
      onSelect={(model) => {
        setPlanner(model)
        dialog.replace(() => (
          <DialogModel
            title="Select cheap executor model"
            onSelect={(executor) => {
              const selectedPlanner = planner()
              if (!selectedPlanner) return
              local.agent.vibe.setModels(selectedPlanner, executor)
              dialog.clear()
            }}
          />
        ))
      }}
    />
  )
}
