using UnrealBuildTool;

public class SailingSimulatorDesktopTarget : TargetRules
{
    public SailingSimulatorDesktopTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.Add("SailingSimulatorDesktop");
    }
}
