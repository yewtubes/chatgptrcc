--!nonstrict
-- Play Solo bootstrap for the web client.
--
-- Replaces the Lua App's entry point (PatchRoot.CoreScripts.LuaAppStarterScript
-- in UniversalApp.rbxm). The app DataModel loads rbxasset://places/Mobile.rbxl,
-- which the local server replaces with the place to play, so here we only turn
-- that edit DataModel into a running single-player session, like Studio's old
-- "Play Solo": create a local player, run the simulation, spawn a character and
-- drive it with a small controller and follow camera.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local function log(...)
	warn("[PlaySolo]", ...)
end

local function try(what, f, ...)
	local ok, err = pcall(f, ...)
	if not ok then
		log(what, "failed:", err)
	end
	return ok, err
end

task.spawn(function()
	log("starting; place has", #workspace:GetDescendants(), "workspace descendants")
	-- The place's saved camera view, used to put the player in front of it.
	local placeView = workspace.CurrentCamera and workspace.CurrentCamera.CFrame

	local player = Players.LocalPlayer
	if not player then
		try("CreateLocalPlayer", function()
			player = Players:CreateLocalPlayer()
		end)
	end
	if not player then
		log("no local player")
		return
	end
	try("RunService:Run", function()
		RunService:Run()
	end)

	local ok = try("LoadCharacter", function()
		player:LoadCharacter()
	end)
	if not ok or not player.Character then
		-- Fallback: build a character from the default rig if LoadCharacter is
		-- not allowed in this DataModel.
		log("waiting for character")
		player.CharacterAdded:Wait()
	end

	local character = player.Character
	local humanoid = character:WaitForChild("Humanoid")
	local root = character:WaitForChild("HumanoidRootPart")
	log("character spawned at", tostring(root.Position))

	-- Avatar assets need a Roblox login (the head mesh, for one), so dress the
	-- character the classic way using only built-in meshes and local textures.
	local function classicLook(char)
		try("classic look", function()
			local colors = char:FindFirstChildOfClass("BodyColors") or Instance.new("BodyColors", char)
			local yellow, blue, green = BrickColor.new("Bright yellow"), BrickColor.new("Bright blue"), BrickColor.new("Br. yellowish green")
			colors.HeadColor, colors.LeftArmColor, colors.RightArmColor = yellow, yellow, yellow
			colors.TorsoColor = blue
			colors.LeftLegColor, colors.RightLegColor = green, green
			local head = char:FindFirstChild("Head")
			if head and head:IsA("MeshPart") then
				-- Dynamic head whose mesh could not be fetched: hide it and weld a
				-- classic head on top.
				head.Transparency = 1
				for _, d in head:GetChildren() do
					if d:IsA("Decal") then d:Destroy() end
				end
				local classic = Instance.new("Part")
				classic.Name = "ClassicHead"
				classic.Size = Vector3.new(2, 1, 1)
				classic.BrickColor = yellow
				classic.CanCollide = false
				classic.Massless = true
				classic.CFrame = head.CFrame
				local mesh = Instance.new("SpecialMesh", classic)
				mesh.MeshType = Enum.MeshType.Head
				mesh.Scale = Vector3.new(1.25, 1.25, 1.25)
				local face = Instance.new("Decal", classic)
				face.Name = "face"
				face.Texture = "rbxasset://textures/face.png"
				local weld = Instance.new("WeldConstraint", classic)
				weld.Part0, weld.Part1 = head, classic
				classic.Parent = char
			elseif head then
				head.BrickColor = yellow
				if not head:FindFirstChildOfClass("SpecialMesh") and not head:IsA("MeshPart") then
					Instance.new("SpecialMesh", head).MeshType = Enum.MeshType.Head
				end
			end
		end)
	end
	classicLook(character)
	player.CharacterAdded:Connect(function(char)
		char:WaitForChild("Head")
		classicLook(char)
	end)

	-- Spawn where the place's camera was looking (the place has no SpawnLocation).
	local yaw0 = 0
	if placeView and not workspace:FindFirstChildWhichIsA("SpawnLocation", true) then
		try("place spawn", function()
			local look = placeView.LookVector * Vector3.new(1, 0, 1)
			if look.Magnitude < 1e-3 then return end
			look = look.Unit
			local params = RaycastParams.new()
			params.FilterDescendantsInstances = { character }
			params.FilterType = Enum.RaycastFilterType.Exclude
			local hit = workspace:Raycast(placeView.Position, placeView.LookVector * 1000, params)
			local target = hit and hit.Position or (placeView.Position + look * 80)
			-- stand a little way in front of what the camera was looking at
			local stand = target - look * 120
			local down = workspace:Raycast(stand + Vector3.new(0, 200, 0), Vector3.new(0, -400, 0), params)
			if down then stand = down.Position end
			yaw0 = math.atan2(-look.X, -look.Z)
			root.CFrame = CFrame.new(stand + Vector3.new(0, 4, 0)) * CFrame.Angles(0, yaw0, 0)
			log("moved to", tostring(stand))
		end)
	end

	local camera = workspace.CurrentCamera
	camera.CameraSubject = humanoid
	camera.CameraType = Enum.CameraType.Scriptable

	-- Controls: WASD/arrows to move, space to jump, right mouse drag or Q/E to
	-- turn the camera, mouse wheel to zoom.
	local keys = {}
	local yaw, pitch, zoom = yaw0, -0.12, 20
	UserInputService.InputBegan:Connect(function(input, processed)
		if input.KeyCode == Enum.KeyCode.Space then
			humanoid.Jump = true
		end
		keys[input.KeyCode] = true
		if input.UserInputType == Enum.UserInputType.MouseButton2 then
			UserInputService.MouseBehavior = Enum.MouseBehavior.LockCurrentPosition
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		keys[input.KeyCode] = nil
		if input.UserInputType == Enum.UserInputType.MouseButton2 then
			UserInputService.MouseBehavior = Enum.MouseBehavior.Default
		end
	end)
	UserInputService.InputChanged:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseMovement
			and UserInputService:IsMouseButtonPressed(Enum.UserInputType.MouseButton2) then
			yaw = yaw - input.Delta.X * 0.008
			pitch = math.clamp(pitch - input.Delta.Y * 0.008, -1.4, 1.2)
		elseif input.UserInputType == Enum.UserInputType.MouseWheel then
			zoom = math.clamp(zoom - input.Position.Z * 2, 4, 60)
		end
	end)

	local function axis(pos, neg, pos2, neg2)
		return ((keys[pos] or keys[pos2]) and 1 or 0) - ((keys[neg] or keys[neg2]) and 1 or 0)
	end

	RunService.RenderStepped:Connect(function(dt)
		if not root.Parent then
			return
		end
		yaw = yaw + axis(Enum.KeyCode.Q, Enum.KeyCode.E) * dt * 2
		local look = CFrame.Angles(0, yaw, 0)
		local f = axis(Enum.KeyCode.W, Enum.KeyCode.S, Enum.KeyCode.Up, Enum.KeyCode.Down)
		local r = axis(Enum.KeyCode.D, Enum.KeyCode.A, Enum.KeyCode.Right, Enum.KeyCode.Left)
		local move = look.LookVector * f + look.RightVector * r
		humanoid:Move(move.Magnitude > 0 and move.Unit or Vector3.zero, false)

		local focus = root.Position + Vector3.new(0, 2, 0)
		local rot = CFrame.Angles(0, yaw, 0) * CFrame.Angles(pitch, 0, 0)
		camera.CFrame = CFrame.new(focus) * rot * CFrame.new(0, 0, zoom)
		camera.Focus = CFrame.new(focus)
	end)

	humanoid.Died:Connect(function()
		task.wait(3)
		try("respawn", function()
			player:LoadCharacter()
		end)
	end)
	log("ready")
end)

return {}
