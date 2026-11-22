using UnrealBuildTool;

public class SailingSimulatorDesktop : ModuleRules
{
    public SailingSimulatorDesktop(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine" });
        PrivateDependencyModuleNames.AddRange(new[] { "AudioMixer", "Chaos", "InputCore", "MediaAssets", "PhysicsCore", "ProceduralMeshComponent", "RHI" });
        PrivateDependencyModuleNames.AddRange(new[] { "ApplicationCore", "Slate", "SlateCore" });
        if (Target.Platform == UnrealTargetPlatform.Mac)
            PublicFrameworks.Add("CoreGraphics");
    }
}
