using UnrealBuildTool;

public class SailingSimulatorDesktopEditorTarget : TargetRules
{
    public SailingSimulatorDesktopEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.Add("SailingSimulatorDesktop");
    }
}
