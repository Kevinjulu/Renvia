import { HandleSSOCallback } from "@clerk/react";
import { useNavigate } from "react-router-dom";

export function SsoCallbackRoute() {
  const navigate = useNavigate();

  return (
    <HandleSSOCallback
      navigateToApp={({ decorateUrl }) => {
        const destination = decorateUrl("/dashboard");
        if (destination.startsWith("http")) {
          window.location.href = destination;
          return;
        }
        navigate(destination);
      }}
      navigateToSignIn={() => navigate("/login")}
      navigateToSignUp={() => navigate("/signup")}
    />
  );
}
