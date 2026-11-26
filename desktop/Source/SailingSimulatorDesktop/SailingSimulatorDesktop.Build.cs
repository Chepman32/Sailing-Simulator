using UnrealBuildTool;

public class SailingSimulatorDesktop : ModuleRules
{
    public SailingSimulatorDesktop(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine" });
        PrivateDependencyModuleNames.AddRange(new[] { "AudioMixer", "Chaos", "InputCore", "MediaAssets", "PhysicsCore", "ProceduralMeshComponent", "RenderCore", "RHI" });
        PrivateDependencyModuleNames.AddRange(new[] { "ApplicationCore", "Slate", "SlateCore" });
        PrivateDependencyModuleNames.Add("SailingLoadingScreen");
        if (Target.Platform == UnrealTargetPlatform.Mac)
            PublicFrameworks.AddRange(new[] { "CoreGraphics", "AVFoundation", "UniformTypeIdentifiers" });
    }
}
