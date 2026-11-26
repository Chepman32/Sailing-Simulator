using UnrealBuildTool;

public class SailingLoadingScreen : ModuleRules
{
    public SailingLoadingScreen(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PrivateDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "MoviePlayer", "Slate", "SlateCore" });
        if (Target.Platform == UnrealTargetPlatform.Mac)
            PublicFrameworks.Add("AppKit");
    }
}
